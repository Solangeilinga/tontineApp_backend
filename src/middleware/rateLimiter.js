// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Limite générale : 100 requêtes / 15 min par IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limite stricte pour OTP : 5 demandes / 10 min par IP
// (envoi du SMS — coûte de l'argent et peut servir au spam, donc strict)
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Trop de demandes OTP. Réessayez dans 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limite dédiée pour la VÉRIFICATION d'un OTP — instance séparée de
// otpLimiter (compteur indépendant) pour ne pas mélanger le budget
// "demander un code" et "vérifier un code" sur une même fenêtre IP.
// Complète (ne remplace pas) le compteur par-numéro de otpService.verifyOTP
// (MAX_OTP_ATTEMPTS) : deux lignes de défense contre le brute-force d'un
// code à 6 chiffres — l'une par IP, l'autre par numéro de téléphone.
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, otpLimiter, otpVerifyLimiter };
