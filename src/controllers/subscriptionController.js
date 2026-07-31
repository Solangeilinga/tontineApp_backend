// src/controllers/subscriptionController.js
const { success, error } = require('../utils/response');
const { PLANS, getPlanConfig } = require('../config/plans');
const sebpay = require('../services/sebpayService');
const subscriptionService = require('../services/subscriptionService');

// ─── LISTER LES PLANS DISPONIBLES (public, pour l'écran de choix) ────────
const getPlans = async (req, res) => {
  return success(res, PLANS);
};

// ─── STATUT DE L'ABONNEMENT DU GÉRANT CONNECTÉ ────────────────────────────
const getMySubscription = async (req, res) => {
  try {
    const sub = await subscriptionService.getOrCreateSubscription(req.tenant.id);
    const isValid = subscriptionService.isSubscriptionValid(sub);
    const effectivePlan = isValid ? sub.plan : 'FREE';
    return success(res, {
      ...sub,
      isValid,
      effectivePlan,
      limits: getPlanConfig(effectivePlan).limits,
      canReactivate: sub.status === 'CANCELED' && isValid,
    });
  } catch (err) {
    console.error('getMySubscription error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── LISTE DES OPÉRATEURS (proxy SebPay, pour afficher OTP si requis) ────
const getOperators = async (req, res) => {
  try {
    const { country } = req.query;
    const result = await sebpay.getOperators(country);
    if (!result.success) return error(res, result.message, 502);
    return success(res, result.data);
  } catch (err) {
    console.error('getOperators error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── INITIER LE PAIEMENT D'UN ABONNEMENT ──────────────────────────────────
const subscribe = async (req, res) => {
  try {
    const { plan, phone, operator, country, otpCode } = req.body;

    if (!['STARTER', 'PRO'].includes(plan)) {
      return error(res, 'Plan invalide. Choisissez STARTER ou PRO.', 400);
    }
    if (!phone || !operator) {
      return error(res, 'Téléphone et opérateur requis', 400);
    }

    const result = await subscriptionService.initiateSubscriptionPayment({
      tenant: req.tenant,
      plan,
      phone,
      operator,
      country,
      otpCode,
    });

    if (!result.success) return error(res, result.message, 400);
    return success(res, result.data, result.message);
  } catch (err) {
    console.error('subscribe error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── ANNULER L'ABONNEMENT ──────────────────────────────────────────────────
const cancel = async (req, res) => {
  try {
    const { immediate } = req.body;
    const result = await subscriptionService.cancelSubscription({
      tenant: req.tenant,
      immediate: immediate === true,
    });
    if (!result.success) return error(res, result.message, 400);
    return success(res, null, result.message);
  } catch (err) {
    console.error('cancel error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── RÉACTIVER UN ABONNEMENT ANNULÉ (avant expiration) ────────────────────
const reactivate = async (req, res) => {
  try {
    const result = await subscriptionService.reactivateSubscription(req.tenant);
    if (!result.success) return error(res, result.message, 400);
    return success(res, null, result.message);
  } catch (err) {
    console.error('reactivate error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── WEBHOOK SEBPAY (statut final d'un paiement) ──────────────────────────
// IMPORTANT : cette route doit recevoir le BODY BRUT (pas encore parsé en
// JSON par express.json()) pour que la vérification HMAC soit fiable.
// Voir index.js — un express.raw() est monté spécifiquement sur cette route
// AVANT express.json() global.
const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-sebpay-signature'];
    const rawBody = req.body; // Buffer, grâce à express.raw()

    if (!sebpay.verifyWebhookSignature(rawBody.toString('utf8'), signature)) {
      console.warn('⚠️  Webhook SebPay avec signature invalide — rejeté.');
      return res.status(401).json({ success: false, message: 'Signature invalide' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    await subscriptionService.handleWebhookPayload(payload);

    // Toujours répondre 200 rapidement, même si le paiement était "pending"
    // ou déjà traité — SebPay ne doit pas retry inutilement.
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('handleWebhook error:', err.message);
    // On répond quand même 200 pour éviter des retries en boucle sur une
    // erreur de notre côté qui ne se résoudra pas toute seule ; l'erreur
    // reste visible dans les logs pour investigation manuelle.
    return res.status(200).json({ success: false });
  }
};

module.exports = {
  getPlans,
  getMySubscription,
  getOperators,
  subscribe,
  cancel,
  reactivate,
  handleWebhook,
};
