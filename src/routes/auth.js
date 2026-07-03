// src/routes/auth.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { otpLimiter } = require('../middleware/rateLimiter');
const { authenticateTenant } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

// ── Validateurs communs
const phoneValidator = body('phone')
  .notEmpty().withMessage('Numéro requis')
  .isString().withMessage('Numéro invalide');

const otpValidator = body('otp')
  .notEmpty().withMessage('Code OTP requis')
  .isLength({ min: 6, max: 6 }).withMessage('Le code doit avoir 6 chiffres');

const nameValidator = body('name')
  .notEmpty().withMessage('Nom requis')
  .isLength({ min: 2 }).withMessage('Le nom doit avoir au moins 2 caractères');

// ── GÉRANT — Inscription
router.post('/tenant/register/request-otp',
  otpLimiter,
  [phoneValidator, nameValidator],
  validate,
  ctrl.tenantRequestOTP
);

router.post('/tenant/register/verify',
  [phoneValidator, otpValidator],
  validate,
  ctrl.tenantVerifyAndRegister
);

// ── GÉRANT — Connexion
router.post('/tenant/login/request-otp',
  otpLimiter,
  [phoneValidator],
  validate,
  ctrl.tenantLoginRequestOTP
);

router.post('/tenant/login/verify',
  [phoneValidator, otpValidator],
  validate,
  ctrl.tenantLoginVerify
);

// ── GÉRANT — Profil
router.put('/tenant/profile',
  authenticateTenant,
  [nameValidator],
  validate,
  ctrl.updateTenantProfile
);

// ── MEMBRE — Rejoindre un groupe via invite
router.post('/member/join/request-otp',
  otpLimiter,
  [
    phoneValidator,
    nameValidator,
    body('inviteCode').notEmpty().withMessage('Code d\'invitation requis'),
  ],
  validate,
  ctrl.memberRequestOTP
);

router.post('/member/join/verify',
  [phoneValidator, otpValidator],
  validate,
  ctrl.memberVerifyAndJoin
);

// ── MEMBRE — Connexion directe
router.post('/member/login/request-otp',
  otpLimiter,
  [phoneValidator],
  validate,
  ctrl.memberLoginRequestOTP
);

router.post('/member/login/verify',
  [phoneValidator, otpValidator],
  validate,
  ctrl.memberLoginVerify
);

module.exports = router;
