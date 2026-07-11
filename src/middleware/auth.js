// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { error } = require('../utils/response');

/**
 * Middleware d'authentification pour les GÉRANTS (tenants)
 */
const authenticateTenant = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Token manquant', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'tenant') {
      return error(res, 'Accès non autorisé', 403);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: decoded.id },
    });

    if (!tenant || !tenant.isActive) {
      return error(res, 'Compte introuvable ou désactivé', 401);
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(res, 'Token expiré', 401);
    }
    return error(res, 'Token invalide', 401);
  }
};

/**
 * Middleware d'authentification pour les MEMBRES (users)
 */
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Token manquant', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'user') {
      return error(res, 'Accès non autorisé', 403);
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { tenant: true },
    });

    if (!user || !user.isActive) {
      return error(res, 'Membre introuvable ou désactivé', 401);
    }

    req.user = user;
    req.tenant = user.tenant;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(res, 'Token expiré', 401);
    }
    return error(res, 'Token invalide', 401);
  }
};

/**
 * Middleware d'authentification acceptant AUSSI BIEN un gérant qu'un membre.
 * Utilisé pour les routes partagées entre les deux (ex: enregistrement du
 * token FCM pour les notifications push). Attache req.tenant OU req.user
 * selon le type de compte, jamais les deux à la fois pour un gérant.
 */
const authenticateAny = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Token manquant', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type === 'tenant') {
      const tenant = await prisma.tenant.findUnique({ where: { id: decoded.id } });
      if (!tenant || !tenant.isActive) {
        return error(res, 'Compte introuvable ou désactivé', 401);
      }
      req.tenant = tenant;
      req.accountType = 'tenant';
      return next();
    }

    if (decoded.type === 'user') {
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        include: { tenant: true },
      });
      if (!user || !user.isActive) {
        return error(res, 'Membre introuvable ou désactivé', 401);
      }
      req.user = user;
      req.tenant = user.tenant;
      req.accountType = 'user';
      return next();
    }

    return error(res, 'Accès non autorisé', 403);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(res, 'Token expiré', 401);
    }
    return error(res, 'Token invalide', 401);
  }
};

/**
 * Génère un access token JWT
 */
const generateToken = (id, type) => {
  return jwt.sign({ id, type }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * Génère un refresh token JWT
 */
const generateRefreshToken = (id, type) => {
  return jwt.sign({ id, type }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
};

module.exports = {
  authenticateTenant,
  authenticateUser,
  authenticateAny,
  generateToken,
  generateRefreshToken,
};