// src/middleware/requireLimit.js
//
// Middleware générique de paywall. S'utilise sur une route en lui passant
// une clé de limite (voir src/config/plans.js) et une fonction qui calcule
// le "count" actuel à comparer (ex: nombre de groupes déjà créés).
//
// Exemple d'utilisation dans une route :
//   router.post('/', authenticateTenant, requireLimit('maxGroups', countTenantGroups), groupCtrl.createGroup);

const { error } = require('../utils/response');
const { checkLimit } = require('../services/subscriptionService');

const requireLimit = (limitKey, getCurrentCount) => async (req, res, next) => {
  try {
    const currentCount = await getCurrentCount(req);
    const { allowed, reason } = await checkLimit(req.tenant.id, limitKey, currentCount);

    if (!allowed) {
      return error(res, reason, 402); // 402 Payment Required
    }

    next();
  } catch (err) {
    console.error('requireLimit error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { requireLimit };
