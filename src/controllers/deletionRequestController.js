// src/controllers/deletionRequestController.js
//
// Exigence Google Play "Account Deletion" : un moyen accessible SANS avoir
// l'app installée. Volontairement PAS un self-service automatique (un
// numéro de téléphone seul ne prouve pas l'identité — n'importe qui pourrait
// demander la suppression du compte de quelqu'un d'autre). Ici, la demande
// est simplement enregistrée et traitée manuellement — délai annoncé dans
// la politique de confidentialité (30 jours).
const logger = require('../config/logger');
const prisma = require('../config/database');
const { success, error } = require('../utils/response');
const { normalizePhone } = require('../utils/phone');

const createDeletionRequest = async (req, res) => {
  try {
    const { name, phone, message } = req.body;

    if (!name || name.trim().length < 2) {
      return error(res, 'Nom requis', 400);
    }
    if (!phone || phone.trim().length < 6) {
      return error(res, 'Numéro de téléphone requis', 400);
    }

    await prisma.deletionRequest.create({
      data: {
        name: name.trim(),
        phone: normalizePhone(phone.trim()),
        message: message?.trim() || null,
      },
    });

    return success(res, null, 'Votre demande a été enregistrée. Elle sera traitée sous 30 jours maximum.');
  } catch (err) {
    logger.error('createDeletionRequest error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { createDeletionRequest };