// src/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticateTenant } = require('../middleware/auth');
const subCtrl = require('../controllers/subscriptionController');

// ─── ROUTES PUBLIQUES ───────────────────────────────────────────────────────
router.get('/plans', subCtrl.getPlans);
router.get('/operators', subCtrl.getOperators);

// ─── WEBHOOK SEBPAY ──────────────────────────────────────────────────────
// Pas d'authenticateTenant ici : c'est SebPay qui appelle, avec une
// signature HMAC vérifiée dans le contrôleur. Body brut monté dans index.js.
router.post('/webhook', subCtrl.handleWebhook);

// ─── ROUTES GÉRANT (authentifiées) ─────────────────────────────────────────
router.get('/me', authenticateTenant, subCtrl.getMySubscription);
router.post(
  '/subscribe',
  authenticateTenant,
  [
    body('plan').isIn(['STARTER', 'PRO']).withMessage('Plan invalide'),
    body('phone').notEmpty().withMessage('Téléphone requis'),
    body('operator').notEmpty().withMessage('Opérateur requis'),
  ],
  validate,
  subCtrl.subscribe
);
router.post(
  '/cancel',
  authenticateTenant,
  [body('immediate').optional().isBoolean().withMessage('immediate doit être un booléen')],
  validate,
  subCtrl.cancel
);
router.post('/reactivate', authenticateTenant, subCtrl.reactivate);

module.exports = router;
