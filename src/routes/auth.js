// src/routes/auth.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { otpLimiter } = require('../middleware/rateLimiter');
const { authenticateTenant, authenticateUser } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

const phoneValidator = body('phone')
  .notEmpty().withMessage('Numéro requis')
  .isString().withMessage('Numéro invalide');

const otpValidator = body('otp')
  .notEmpty().withMessage('Code OTP requis')
  .isLength({ min: 6, max: 6 }).withMessage('Le code doit avoir 6 chiffres');

const nameValidator = body('name')
  .notEmpty().withMessage('Nom requis')
  .isLength({ min: 2, max: 100 }).withMessage('Le nom doit avoir entre 2 et 100 caractères');

const pinValidator = body('pin')
  .notEmpty().withMessage('PIN requis')
  .isLength({ min: 4, max: 4 }).withMessage('PIN doit avoir 4 chiffres')
  .isNumeric().withMessage('PIN doit être numérique');

// ── GÉRANT — Inscription
router.post('/tenant/register/request-otp',
  otpLimiter, [phoneValidator, nameValidator], validate,
  ctrl.tenantRequestOTP
);
router.post('/tenant/register/verify',
  [phoneValidator, otpValidator], validate,
  ctrl.tenantVerifyAndRegister
);

// ── GÉRANT — Connexion
router.post('/tenant/login/request-otp',
  otpLimiter, [phoneValidator], validate,
  ctrl.tenantLoginRequestOTP
);
router.post('/tenant/login/verify',
  [phoneValidator, otpValidator], validate,
  ctrl.tenantLoginVerify
);

// ── GÉRANT — PIN (avec token)
router.get('/tenant/pin/status', authenticateTenant, ctrl.tenantHasPin);
router.post('/tenant/pin/set',
  authenticateTenant, [pinValidator], validate,
  ctrl.tenantSetPin
);
router.post('/tenant/pin/verify',
  authenticateTenant, [pinValidator], validate,
  ctrl.tenantVerifyPin
);

// ── GÉRANT — PIN (session verrouillée — sans token)
router.post('/tenant/pin/verify-locked',
  otpLimiter,
  [phoneValidator, pinValidator], validate,
  ctrl.tenantVerifyPinLocked
);

// ── GÉRANT — Profil
router.put('/tenant/profile',
  authenticateTenant, [nameValidator], validate,
  ctrl.updateTenantProfile
);

// ── MEMBRE — Rejoindre
router.post('/member/join/request-otp',
  otpLimiter,
  [phoneValidator, nameValidator, body('inviteCode').notEmpty()],
  validate,
  ctrl.memberRequestOTP
);
router.post('/member/join/verify',
  [phoneValidator, otpValidator], validate,
  ctrl.memberVerifyAndJoin
);

// ── MEMBRE — Connexion
router.post('/member/login/request-otp',
  otpLimiter, [phoneValidator], validate,
  ctrl.memberLoginRequestOTP
);
router.post('/member/login/verify',
  [phoneValidator, otpValidator], validate,
  ctrl.memberLoginVerify
);

// ── MEMBRE — PIN (avec token)
router.get('/member/pin/status', authenticateUser, ctrl.userHasPin);
router.post('/member/pin/set',
  authenticateUser, [pinValidator], validate,
  ctrl.userSetPin
);
router.post('/member/pin/verify',
  authenticateUser, [pinValidator], validate,
  ctrl.userVerifyPin
);

// ── MEMBRE — PIN (session verrouillée — sans token)
router.post('/member/pin/verify-locked',
  otpLimiter,
  [phoneValidator, pinValidator], validate,
  ctrl.userVerifyPinLocked
);

module.exports = router;