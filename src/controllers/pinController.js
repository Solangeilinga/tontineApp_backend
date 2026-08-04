// src/controllers/pinController.js — Gestion du code PIN (gérant ET membre)
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

// ─── GÉRANT : PIN ─────────────────────────────────────────────────────────
const tenantSetPin = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return error(res, 'Le PIN doit être 4 chiffres', 400);
    }
    const pinHash = await bcrypt.hash(pin, 12);
    await prisma.tenant.update({
      where: { id: req.tenant.id },
      data: { pinHash },
    });
    return success(res, null, 'PIN défini avec succès');
  } catch (err) {
    logger.error('tenantSetPin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const tenantVerifyPin = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) return error(res, 'PIN invalide', 400);

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenant.id },
      select: { pinHash: true },
    });
    if (!tenant?.pinHash) return error(res, 'Aucun PIN défini', 404);

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const key = `pin_attempts:tenant:${req.tenant.id}`;
    const currentAttempts = await redis.get(key);
    if (currentAttempts && parseInt(currentAttempts) >= 5) {
      return error(res, 'Trop de tentatives. Réessayez dans 15 minutes.', 429);
    }

    const isValid = await bcrypt.compare(pin, tenant.pinHash);
    if (!isValid) {
      const attempts = await redis.incr(key);
      await redis.expire(key, 900);
      return error(res, `PIN incorrect (${attempts}/5)`, 401);
    }

    await redis.del(key);
    return success(res, null, 'PIN valide');
  } catch (err) {
    logger.error('tenantVerifyPin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const tenantHasPin = async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenant.id },
      select: { pinHash: true },
    });
    return success(res, { hasPin: !!tenant?.pinHash });
  } catch (err) {
    logger.error('tenantHasPin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : PIN session verrouillée ─────────────────────────────────────

// ─── GÉRANT : PIN session verrouillée ─────────────────────────────────────
const tenantVerifyPinLocked = async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) return error(res, 'PIN invalide', 400);

    const normalizedPhone = normalizePhone(phone);
    const tenant = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
      select: { id: true, pinHash: true, isActive: true,
                name: true, phone: true, photoUrl: true },
    });

    if (!tenant || !tenant.isActive || !tenant.pinHash) {
      return error(res, 'PIN incorrect', 401);
    }

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const key = `pin_attempts:tenant:${tenant.id}`;
    const currentAttempts = await redis.get(key);
    if (currentAttempts && parseInt(currentAttempts) >= 5) {
      return error(res, 'Trop de tentatives. Reconnectez-vous par SMS.', 429);
    }

    const isValid = await bcrypt.compare(pin, tenant.pinHash);
    if (!isValid) {
      const attempts = await redis.incr(key);
      await redis.expire(key, 900);
      return error(res, `PIN incorrect (${attempts}/5)`, 401);
    }

    await redis.del(key);

    const accessToken = generateToken(tenant.id, 'tenant');
    const refreshToken = generateRefreshToken(tenant.id, 'tenant');

    return success(res, {
      tenant: { id: tenant.id, name: tenant.name,
                phone: tenant.phone, photoUrl: tenant.photoUrl },
      accessToken,
      refreshToken,
    }, 'PIN valide');
  } catch (err) {
    logger.error('tenantVerifyPinLocked error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : PIN ─────────────────────────────────────────────────────────

// ─── MEMBRE : PIN ─────────────────────────────────────────────────────────
const userSetPin = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return error(res, 'Le PIN doit être 4 chiffres', 400);
    }
    const pinHash = await bcrypt.hash(pin, 12);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { pinHash },
    });
    return success(res, null, 'PIN défini avec succès');
  } catch (err) {
    logger.error('userSetPin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const userVerifyPin = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) return error(res, 'PIN invalide', 400);

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { pinHash: true },
    });
    if (!user?.pinHash) return error(res, 'Aucun PIN défini', 404);

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const key = `pin_attempts:user:${req.user.id}`;
    const currentAttempts = await redis.get(key);
    if (currentAttempts && parseInt(currentAttempts) >= 5) {
      return error(res, 'Trop de tentatives. Réessayez dans 15 minutes.', 429);
    }

    const isValid = await bcrypt.compare(pin, user.pinHash);
    if (!isValid) {
      const attempts = await redis.incr(key);
      await redis.expire(key, 900);
      return error(res, `PIN incorrect (${attempts}/5)`, 401);
    }

    await redis.del(key);
    return success(res, null, 'PIN valide');
  } catch (err) {
    logger.error('userVerifyPin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const userHasPin = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { pinHash: true },
    });
    return success(res, { hasPin: !!user?.pinHash });
  } catch (err) {
    logger.error('userHasPin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : PIN session verrouillée ─────────────────────────────────────

// ─── MEMBRE : PIN session verrouillée ─────────────────────────────────────
const userVerifyPinLocked = async (req, res) => {
  try {
    const { phone, pin, userId } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) return error(res, 'PIN invalide', 400);

    let user;
    if (userId) {
      // Cas normal : le client connaît précisément quel compte il déverrouille
      // (userId mis en cache lors de la dernière connexion). Aucune
      // ambiguïté possible, même si ce numéro est membre chez plusieurs
      // gérants différents.
      user = await prisma.user.findFirst({
        where: { id: userId, isActive: true },
        select: { id: true, pinHash: true, name: true, phone: true },
      });
    } else {
      // Repli pour les anciennes versions de l'app qui n'envoient pas encore
      // userId : on devine via le téléphone. ATTENTION — si ce numéro est
      // membre chez plusieurs gérants, ceci peut retomber sur le mauvais
      // compte (et donc rejeter un PIN pourtant correct). À supprimer une
      // fois toutes les apps en circulation mises à jour.
      logger.warn('⚠️  userVerifyPinLocked sans userId — repli ambigu par téléphone seul.');
      const normalizedPhone = normalizePhone(phone);
      user = await prisma.user.findFirst({
        where: { phone: normalizedPhone, isActive: true },
        select: { id: true, pinHash: true, name: true, phone: true },
      });
    }

    if (!user || !user.pinHash) {
      return error(res, 'PIN incorrect', 401);
    }

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const key = `pin_attempts:user:${user.id}`;
    const currentAttempts = await redis.get(key);
    if (currentAttempts && parseInt(currentAttempts) >= 5) {
      return error(res, 'Trop de tentatives. Reconnectez-vous par SMS.', 429);
    }

    const isValid = await bcrypt.compare(pin, user.pinHash);
    if (!isValid) {
      const attempts = await redis.incr(key);
      await redis.expire(key, 900);
      return error(res, `PIN incorrect (${attempts}/5)`, 401);
    }

    await redis.del(key);

    const accessToken = generateToken(user.id, 'user');
    const refreshToken = generateRefreshToken(user.id, 'user');

    return success(res, {
      user: { id: user.id, name: user.name, phone: user.phone },
      accessToken,
      refreshToken,
    }, 'PIN valide');
  } catch (err) {
    logger.error('userVerifyPinLocked error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── RAFRAÎCHIR L'ACCESS TOKEN À PARTIR DU REFRESH TOKEN ──────────────────
// Auparavant : un refreshToken était généré et stocké côté app à chaque
// connexion, mais aucune route ne permettait de s'en servir — l'app se
// contentait de renvoyer l'utilisateur à l'écran PIN dès l'expiration de
// l'access token (7 jours). Cette route complète le flux : verrouiller la
// session reste le comportement par défaut à l'expiration DU refresh token
// (30 jours), mais entre les deux, un access token expiré peut être
// renouvelé silencieusement sans redemander le PIN.

module.exports = {
  tenantSetPin,
  tenantVerifyPin,
  tenantHasPin,
  tenantVerifyPinLocked,
  userSetPin,
  userVerifyPin,
  userHasPin,
  userVerifyPinLocked,
};
