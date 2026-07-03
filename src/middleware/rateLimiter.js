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
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Trop de demandes OTP. Réessayez dans 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, otpLimiter };
