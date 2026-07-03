// src/utils/phone.js

/**
 * Normalise un numéro de téléphone au format international E.164
 * Exemples : 70000001 → +22670000001, 0022670000001 → +22670000001
 */
const normalizePhone = (phone, defaultCountryCode = '+226') => {
  if (!phone) return null;

  // Supprimer espaces et tirets
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Déjà au format international
  if (cleaned.startsWith('+')) return cleaned;

  // Format 00XXXX
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);

  // Format local (8 chiffres pour Burkina Faso)
  if (cleaned.length === 8) return defaultCountryCode + cleaned;

  return cleaned;
};

/**
 * Valide qu'un numéro est au format E.164
 */
const isValidPhone = (phone) => {
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  return e164Regex.test(phone);
};

module.exports = { normalizePhone, isValidPhone };
