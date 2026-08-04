// src/controllers/tokenController.js — Rafraîchissement de l'access token
const logger = require('../config/logger');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { sendOTP, verifyOTP } = require('../services/otpService');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const { success, error, created } = require('../utils/response');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { logAction } = require('../services/auditService');
const { createNotification, sendPushNotification } = require('../services/notificationService');
const { cancelSubscription } = require('../services/subscriptionService');
const bcrypt = require('bcryptjs');

// ─── RAFRAÎCHIR L'ACCESS TOKEN À PARTIR DU REFRESH TOKEN ──────────────────
// Auparavant : un refreshToken était généré et stocké côté app à chaque
// connexion, mais aucune route ne permettait de s'en servir — l'app se
// contentait de renvoyer l'utilisateur à l'écran PIN dès l'expiration de
// l'access token (7 jours). Cette route complète le flux : verrouiller la
// session reste le comportement par défaut à l'expiration DU refresh token
// (30 jours), mais entre les deux, un access token expiré peut être
// renouvelé silencieusement sans redemander le PIN.
const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return error(res, 'refreshToken requis', 400);

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return error(res, 'Refresh token invalide ou expiré', 401);
    }

    if (decoded.type === 'tenant') {
      const tenant = await prisma.tenant.findUnique({ where: { id: decoded.id } });
      if (!tenant || !tenant.isActive) return error(res, 'Compte introuvable ou désactivé', 401);

      return success(res, {
        accessToken: generateToken(tenant.id, 'tenant'),
        // Rotation du refresh token : limite la fenêtre d'usage d'un
        // refresh token volé (ex: appareil compromis puis restauré).
        refreshToken: generateRefreshToken(tenant.id, 'tenant'),
      });
    }

    if (decoded.type === 'user') {
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (!user || !user.isActive) return error(res, 'Membre introuvable ou désactivé', 401);

      return success(res, {
        accessToken: generateToken(user.id, 'user'),
        refreshToken: generateRefreshToken(user.id, 'user'),
      });
    }

    return error(res, 'Refresh token invalide', 401);
  } catch (err) {
    logger.error('refreshAccessToken error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  refreshAccessToken,
};
