// src/utils/response.js

const success = (res, data, message = 'Succès', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const error = (res, message = 'Erreur serveur', statusCode = 500, errors = null) => {
  const response = { success: false, message };
  if (errors) response.errors = errors;
  return res.status(statusCode).json(response);
};

const created = (res, data, message = 'Créé avec succès') => {
  return success(res, data, message, 201);
};

module.exports = { success, error, created };
