// src/utils/otp.js
const crypto = require('crypto');

/**
 * Génère un OTP numérique de longueur donnée
 */
const generateOTP = (length = 6) => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, digits.length)];
  }
  return otp;
};

/**
 * Génère un code d'invitation unique pour un groupe
 */
const generateInviteCode = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

module.exports = { generateOTP, generateInviteCode };
