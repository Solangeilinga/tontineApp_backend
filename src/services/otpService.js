// src/services/otpService.js
const logger = require('../config/logger');
const AfricasTalking = require('africastalking');
const { getRedisClient } = require('../config/redis');
const { generateOTP } = require('../utils/otp');

const OTP_PREFIX = 'otp:';
const OTP_ATTEMPTS_PREFIX = 'otp_attempts:';
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
const OTP_EXPIRY = (Number.isNaN(OTP_EXPIRY_MINUTES) ? 10 : OTP_EXPIRY_MINUTES) * 60; // secondes
// Nombre max de tentatives de vérification par numéro pendant la durée de
// vie d'un OTP — empêche le brute-force d'un code à 6 chiffres (1M
// combinaisons) même si le rate-limiter global de la route est contourné
// (plusieurs IP, etc.). Même logique que le compteur `pin_attempts`.
const MAX_OTP_ATTEMPTS = 5;

// Initialiser Africa's Talking
const at = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME,
});
const sms = at.SMS;

/**
 * Envoie un OTP par SMS et le stocke dans Redis
 */
// ── Diagnostic temporaire — à retirer une fois le bug de blocage identifié.
// `sms.send()` (Africa's Talking) n'a pas de timeout interne : si leur API
// ne répond jamais, la requête entière reste pendante indéfiniment côté
// client (observé : DioExceptionType.receiveTimeout après 45s, RIEN dans
// les logs Render car la réponse HTTP n'est jamais envoyée). Ce wrapper
// force un échec net après 15s pour confirmer si c'est bien là que ça
// bloque, plutôt que de laisser la requête pendre pour toujours.
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms) sur : ${label}`)), ms)
    ),
  ]);

const sendOTP = async (phone) => {
  const otp = generateOTP(parseInt(process.env.OTP_LENGTH || '6'));
  const key = `${OTP_PREFIX}${phone}`;

  logger.info(`[OTP] Étape 1/4 — connexion Redis pour ${phone}`);
  const redis = await withTimeout(getRedisClient(), 15000, 'getRedisClient()');
  logger.info('[OTP] Étape 2/4 — Redis connecté, écriture de la clé');

  // Stocker dans Redis avec expiration
  await withTimeout(redis.setEx(key, OTP_EXPIRY, otp), 15000, 'redis.setEx()');
  logger.info('[OTP] Étape 3/4 — clé écrite dans Redis');

  // En développement, on affiche l'OTP dans les logs
  if (process.env.NODE_ENV === 'development') {
    logger.info(`🔑 OTP pour ${phone}: ${otp}`);
    return { success: true, dev_otp: otp };
  }

  // En production, envoi SMS via Africa's Talking
  try {
    const smsPayload = {
      to: [phone],
      message: `MaTontine : votre code est ${otp}. Valable ${OTP_EXPIRY_MINUTES} min. Bienvenue !`,
    };
    // N'ajoute "from" que si un Sender ID est explicitement configuré et
    // approuvé — sinon Africa's Talking utilise son expéditeur générique.
    if (process.env.AT_SENDER_ID) smsPayload.from = process.env.AT_SENDER_ID;

    logger.info('[OTP] Étape 4/4 — appel sms.send() vers Africa\'s Talking');
    const response = await withTimeout(sms.send(smsPayload), 15000, "sms.send() Africa's Talking");
    logger.info('[OTP] sms.send() a répondu');

    const recipient = response?.SMSMessageData?.Recipients?.[0];
    logger.info('📋 Réponse Africa\'s Talking:', JSON.stringify(response?.SMSMessageData || response));

    if (!recipient || recipient.status !== 'Success') {
      const reason = response?.SMSMessageData?.Message || recipient?.status || 'réponse invalide';
      throw new Error(`Livraison échouée — ${reason}${recipient?.statusCode ? ` (code ${recipient.statusCode})` : ''}`);
    }

    logger.info(`✅ OTP envoyé par SMS à ${phone} — coût: ${recipient.cost}`);
    return { success: true };
  } catch (err) {
    logger.error('❌ Erreur envoi SMS:', err.message);
    // Supprimer l'OTP de Redis si envoi échoue
    await redis.del(key);
    throw new Error("Échec de l'envoi du SMS. Réessayez.");
  }
};

/**
 * Vérifie un OTP pour un numéro donné.
 * Protégé par un compteur de tentatives par numéro (Redis) en plus du
 * rate-limiter global de la route — voir MAX_OTP_ATTEMPTS ci-dessus.
 */
const verifyOTP = async (phone, otp) => {
  const key = `${OTP_PREFIX}${phone}`;
  const attemptsKey = `${OTP_ATTEMPTS_PREFIX}${phone}`;
  const redis = await getRedisClient();

  const attempts = parseInt((await redis.get(attemptsKey)) || '0', 10);
  if (attempts >= MAX_OTP_ATTEMPTS) {
    return { valid: false, reason: 'Trop de tentatives. Redemandez un nouveau code.' };
  }

  const storedOTP = await redis.get(key);

  if (!storedOTP) {
    return { valid: false, reason: 'OTP expiré ou inexistant' };
  }

  if (storedOTP !== otp) {
    // Incrémente le compteur d'échecs, avec la même expiration que l'OTP
    // lui-même (inutile de bloquer plus longtemps qu'un code n'est valide).
    const newCount = await redis.incr(attemptsKey);
    if (newCount === 1) await redis.expire(attemptsKey, OTP_EXPIRY);
    return { valid: false, reason: 'Code incorrect' };
  }

  // Succès : supprimer l'OTP (usage unique) et le compteur de tentatives
  await redis.del(key);
  await redis.del(attemptsKey);

  return { valid: true };
};

module.exports = { sendOTP, verifyOTP };