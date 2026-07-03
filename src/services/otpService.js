// src/services/otpService.js
const AfricasTalking = require('africastalking');
const { getRedisClient } = require('../config/redis');
const { generateOTP } = require('../utils/otp');

const OTP_PREFIX = 'otp:';
const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_MINUTES || '5') * 60; // secondes

// Initialiser Africa's Talking
const at = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME,
});
const sms = at.SMS;

/**
 * Envoie un OTP par SMS et le stocke dans Redis
 */
const sendOTP = async (phone) => {
  const otp = generateOTP(parseInt(process.env.OTP_LENGTH || '6'));
  const key = `${OTP_PREFIX}${phone}`;

  const redis = await getRedisClient();

  // Stocker dans Redis avec expiration
  await redis.setEx(key, OTP_EXPIRY, otp);

  // En développement, on affiche l'OTP dans les logs
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔑 OTP pour ${phone}: ${otp}`);
    return { success: true, dev_otp: otp };
  }

  // En production, envoi SMS via Africa's Talking
  try {
    await sms.send({
      to: [phone],
      message: `Votre code de vérification TontineApp est : ${otp}. Valable ${process.env.OTP_EXPIRY_MINUTES || 5} minutes.`,
      from: process.env.AT_SENDER_ID || 'TontineApp',
    });
    return { success: true };
  } catch (err) {
    console.error('❌ Erreur envoi SMS:', err);
    // Supprimer l'OTP de Redis si envoi échoue
    await redis.del(key);
    throw new Error("Échec de l'envoi du SMS. Réessayez.");
  }
};

/**
 * Vérifie un OTP pour un numéro donné
 */
const verifyOTP = async (phone, otp) => {
  const key = `${OTP_PREFIX}${phone}`;
  const redis = await getRedisClient();

  const storedOTP = await redis.get(key);

  if (!storedOTP) {
    return { valid: false, reason: 'OTP expiré ou inexistant' };
  }

  if (storedOTP !== otp) {
    return { valid: false, reason: 'Code incorrect' };
  }

  // Supprimer l'OTP après vérification réussie (usage unique)
  await redis.del(key);

  return { valid: true };
};

module.exports = { sendOTP, verifyOTP };
