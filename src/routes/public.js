// src/routes/public.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { otpLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/deletionRequestController');

// Réutilise otpLimiter (5 requêtes/10 min par IP) — même profil de risque
// qu'un formulaire public à protéger contre le spam automatisé.
router.post('/deletion-requests',
  otpLimiter,
  [
    body('name').notEmpty().withMessage('Nom requis'),
    body('phone').notEmpty().withMessage('Téléphone requis'),
  ],
  validate,
  ctrl.createDeletionRequest
);

module.exports = router;