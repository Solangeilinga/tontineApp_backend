// src/services/sebpayService.js
//
// Toute la logique d'appel à l'API SebPay est centralisée ici. Aucun
// contrôleur ne doit connaître l'URL ou les headers SebPay directement —
// ça facilite le passage sandbox → live et le mock en tests.
//
// Docs SebPay : https://new.sebpay.bj/fr/docs

const logger = require('../config/logger');
const crypto = require('crypto');

const SEBPAY_BASE_URL = process.env.SEBPAY_BASE_URL || 'https://newapi.sebpay.bj/api/v1';
const SEBPAY_PUBLIC_KEY = process.env.SEBPAY_PUBLIC_KEY;
const SEBPAY_SECRET_KEY = process.env.SEBPAY_SECRET_KEY;
const SEBPAY_CALLBACK_URL = process.env.SEBPAY_CALLBACK_URL; // ex: https://api.matontine.app/api/subscriptions/webhook

if (!SEBPAY_PUBLIC_KEY || !SEBPAY_SECRET_KEY) {
  // On ne throw pas au chargement du module (permet de démarrer le serveur
  // même en dev sans clés), mais on log fort pour que ce soit visible.
  logger.warn('⚠️  SEBPAY_PUBLIC_KEY / SEBPAY_SECRET_KEY non configurées — les paiements échoueront.');
}

const sebpayHeaders = () => ({
  'X-Public-Key': SEBPAY_PUBLIC_KEY,
  'X-Secret-Key': SEBPAY_SECRET_KEY,
  'Content-Type': 'application/json',
});

/**
 * Initie une collecte Mobile Money via SebPay pour payer un abonnement.
 *
 * @param {Object} params
 * @param {number} params.amount - Montant en XOF (499 ou 900).
 * @param {string} params.phone - Numéro au format international sans le '+'.
 * @param {string} params.operator - Slug opérateur (mtn, moov, orange...).
 * @param {string} params.country - Code ISO pays (BJ, CI, SN...).
 * @param {string} params.externalReference - Référence unique générée par nous.
 * @param {string} [params.otpCode] - Requis pour certains opérateurs (voir getOperators).
 * @returns {Promise<{success: boolean, data?: object, message: string}>}
 */
async function initiateCollection({ amount, phone, operator, country, externalReference, otpCode }) {
  const body = {
    amount,
    currency: 'XOF',
    phone,
    operator,
    country,
    external_reference: externalReference,
    callback_url: SEBPAY_CALLBACK_URL,
  };
  if (otpCode) body.otp_code = otpCode;

  const res = await fetch(`${SEBPAY_BASE_URL}/collections`, {
    method: 'POST',
    headers: sebpayHeaders(),
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.success) {
    return {
      success: false,
      message: json?.message || `Erreur SebPay (HTTP ${res.status})`,
      data: json?.data || null,
    };
  }

  return { success: true, data: json.data, message: json.message };
}

/**
 * Récupère le statut actuel d'une transaction (utilisé en complément du
 * webhook, jamais comme mécanisme principal — cf. doc SebPay).
 */
async function getCollectionStatus(idOrReference) {
  const res = await fetch(`${SEBPAY_BASE_URL}/collections/${encodeURIComponent(idOrReference)}`, {
    method: 'GET',
    headers: sebpayHeaders(),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    return { success: false, message: json?.message || `Erreur SebPay (HTTP ${res.status})` };
  }
  return { success: true, data: json.data };
}

/**
 * Retourne la liste des opérateurs pour un pays, avec leur champ
 * otp_required — à interroger côté app avant d'afficher (ou non) un champ
 * OTP au gérant qui paie son abonnement.
 */
async function getOperators(country) {
  const url = country
    ? `${SEBPAY_BASE_URL}/operators?country=${encodeURIComponent(country)}`
    : `${SEBPAY_BASE_URL}/operators`;
  const res = await fetch(url, { method: 'GET', headers: sebpayHeaders() });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    return { success: false, message: json?.message || `Erreur SebPay (HTTP ${res.status})` };
  }
  return { success: true, data: json.data };
}

/**
 * Vérifie la signature HMAC-SHA256 d'un webhook SebPay.
 *
 * CRITIQUE : sans cette vérification, n'importe qui pourrait POSTer un faux
 * webhook "approved" sur notre endpoint et activer un abonnement gratuitement.
 *
 * @param {string} rawBody - Corps de la requête brut (non parsé), tel que reçu.
 * @param {string} signatureHeader - Valeur de l'en-tête X-SebPay-Signature.
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !SEBPAY_SECRET_KEY) return false;

  const expected = crypto
    .createHmac('sha256', SEBPAY_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  // Comparaison en temps constant pour éviter les attaques par timing.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  initiateCollection,
  getCollectionStatus,
  getOperators,
  verifyWebhookSignature,
};
