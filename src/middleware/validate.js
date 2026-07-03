// src/middleware/validate.js
const { validationResult } = require('express-validator');
const { error } = require('../utils/response');

/**
 * Middleware qui vérifie les erreurs de validation express-validator
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return error(res, 'Données invalides', 422, errors.array());
  }
  next();
};

module.exports = { validate };
