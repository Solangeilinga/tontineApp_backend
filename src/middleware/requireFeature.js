// src/middleware/requireFeature.js
//
// Variante booléenne de requireLimit — pour les fonctionnalités du type
// "activée ou non selon le plan" (export, journal d'audit complet), par
// opposition aux quotas numériques (maxGroups, maxMembersPerGroup).
//
// Exemple d'utilisation :
//   router.get('/:groupId/export', authenticateTenant, requireFeature('exportEnabled'), ctrl.exportContributions);

const logger = require('../config/logger');
const { error } = require('../utils/response');
const { checkFeature } = require('../services/subscriptionService');

const requireFeature = (featureKey) => async (req, res, next) => {
  try {
    const { allowed, reason } = await checkFeature(req.tenant.id, featureKey);
    if (!allowed) return error(res, reason, 402); // 402 Payment Required
    next();
  } catch (err) {
    logger.error('requireFeature error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { requireFeature };
