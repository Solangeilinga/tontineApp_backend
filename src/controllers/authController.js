// src/controllers/authController.js
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { sendOTP, verifyOTP } = require('../services/otpService');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const { success, error, created } = require('../utils/response');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const bcrypt = require('bcryptjs');

// ─── GÉRANT : Inscription OTP ──────────────────────────────────────────────
const tenantRequestOTP = async (req, res) => {
  try {
    const { phone, name } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!isValidPhone(normalizedPhone)) {
      return error(res, 'Numéro invalide', 400);
    }

    if (!name || name.trim().length < 2 || name.trim().length > 100) {
      return error(res, 'Nom invalide', 400);
    }

    const existing = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });

    if (existing) {
      return success(res, null, 'Si ce numéro n\'est pas encore enregistré, vous pouvez continuer.');
    }

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    await redis.setEx(
      `pending_tenant:${normalizedPhone}`,
      600,
      JSON.stringify({ name: name.trim() })
    );

    await sendOTP(normalizedPhone);
    return success(res, null, 'Code envoyé');
  } catch (err) {
    console.error('tenantRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Vérifier OTP inscription ────────────────────────────────────
const tenantVerifyAndRegister = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) return error(res, 'Code incorrect ou expiré', 400);

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const pendingData = await redis.get(`pending_tenant:${normalizedPhone}`);
    if (!pendingData) return error(res, 'Session expirée. Recommencez.', 400);

    const { name } = JSON.parse(pendingData);
    await redis.del(`pending_tenant:${normalizedPhone}`);

    const existing = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });
    if (existing) return error(res, 'Ce numéro est déjà enregistré.', 409);

    const tenant = await prisma.tenant.create({
      data: { name, phone: normalizedPhone },
    });

    const accessToken = generateToken(tenant.id, 'tenant');
    const refreshToken = generateRefreshToken(tenant.id, 'tenant');

    return created(res, {
      tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone },
      accessToken,
      refreshToken,
    }, 'Compte créé avec succès');
  } catch (err) {
    console.error('tenantVerifyAndRegister error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Connexion OTP ────────────────────────────────────────────────
const tenantLoginRequestOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!isValidPhone(normalizedPhone)) return error(res, 'Numéro invalide', 400);

    const tenant = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });

    if (!tenant || !tenant.isActive) {
      console.log(`ℹ️ tenantLoginRequestOTP: aucun tenant actif pour ${normalizedPhone} — aucun SMS envoyé (comportement anti-énumération)`);
      return success(res, null, 'Si ce numéro est enregistré, un code vous sera envoyé.');
    }

    await sendOTP(normalizedPhone);
    return success(res, null, 'Si ce numéro est enregistré, un code vous sera envoyé.');
  } catch (err) {
    console.error('tenantLoginRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Vérifier OTP connexion ──────────────────────────────────────
const tenantLoginVerify = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) return error(res, 'Code incorrect ou expiré', 400);

    const tenant = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });
    if (!tenant || !tenant.isActive) return error(res, 'Code incorrect ou expiré', 400);

    const accessToken = generateToken(tenant.id, 'tenant');
    const refreshToken = generateRefreshToken(tenant.id, 'tenant');

    return success(res, {
      tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, photoUrl: tenant.photoUrl },
      accessToken,
      refreshToken,
    }, 'Connexion réussie');
  } catch (err) {
    console.error('tenantLoginVerify error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Rejoindre OTP ────────────────────────────────────────────────
const memberRequestOTP = async (req, res) => {
  try {
    const { phone, name, inviteCode } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!isValidPhone(normalizedPhone)) return error(res, 'Numéro invalide', 400);
    if (!name || name.trim().length < 2 || name.trim().length > 100) {
      return error(res, 'Nom invalide', 400);
    }

    const group = await prisma.group.findUnique({
      where: { inviteCode },
      include: { _count: { select: { groupMembers: true } } },
    });

    if (!group) return error(res, 'Code d\'invitation invalide', 404);
    if (!group.isActive) return error(res, 'Ce groupe n\'est plus actif', 400);
    if (group.maxMembers !== null && group._count.groupMembers >= group.maxMembers) {
      return error(res, 'Ce groupe est complet.', 400);
    }

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    await redis.setEx(
      `pending_member:${normalizedPhone}`,
      600,
      JSON.stringify({ name: name.trim(), inviteCode, tenantId: group.tenantId, groupId: group.id })
    );

    await sendOTP(normalizedPhone);
    return success(res, { groupName: group.name }, 'Code envoyé');
  } catch (err) {
    console.error('memberRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Vérifier OTP rejoindre ──────────────────────────────────────
const memberVerifyAndJoin = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) return error(res, 'Code incorrect ou expiré', 400);

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const pendingData = await redis.get(`pending_member:${normalizedPhone}`);
    if (!pendingData) return error(res, 'Session expirée. Recommencez.', 400);

    const { name, tenantId, groupId } = JSON.parse(pendingData);
    await redis.del(`pending_member:${normalizedPhone}`);

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { _count: { select: { groupMembers: true } } },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);
    if (group.maxMembers !== null && group._count.groupMembers >= group.maxMembers) {
      return error(res, 'Ce groupe est complet.', 400);
    }

    let user = await prisma.user.findUnique({
      where: { tenantId_phone: { tenantId, phone: normalizedPhone } },
    });
    if (!user) {
      user = await prisma.user.create({
        data: { tenantId, name, phone: normalizedPhone },
      });
    }

    const existingMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    });
    if (!existingMember) {
      const maxTurn = await prisma.groupMember.aggregate({
        where: { groupId },
        _max: { orderTurn: true },
      });
      await prisma.groupMember.create({
        data: { groupId, userId: user.id, orderTurn: (maxTurn._max.orderTurn || 0) + 1 },
      });
    }

    const accessToken = generateToken(user.id, 'user');
    const refreshToken = generateRefreshToken(user.id, 'user');

    return success(res, {
      user: { id: user.id, name: user.name, phone: user.phone },
      accessToken,
      refreshToken,
    }, 'Vous avez rejoint le groupe avec succès');
  } catch (err) {
    console.error('memberVerifyAndJoin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Connexion OTP ────────────────────────────────────────────────
const memberLoginRequestOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!isValidPhone(normalizedPhone)) return error(res, 'Numéro invalide', 400);

    const user = await prisma.user.findFirst({
      where: { phone: normalizedPhone, isActive: true },
    });

    if (!user) {
      console.log(`ℹ️ memberLoginRequestOTP: aucun user actif pour ${normalizedPhone} — aucun SMS envoyé (comportement anti-énumération)`);
      return success(res, null, 'Si ce numéro est enregistré, un code vous sera envoyé.');
    }

    await sendOTP(normalizedPhone);
    return success(res, null, 'Si ce numéro est enregistré, un code vous sera envoyé.');
  } catch (err) {
    console.error('memberLoginRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Vérifier OTP connexion ──────────────────────────────────────
// Un même numéro peut être membre chez PLUSIEURS gérants différents (une
// ligne `User` par tenant, cf. @@unique([tenantId, phone])). Après
// vérification de l'OTP, on doit donc distinguer deux cas :
//  - 1 seul compte trouvé  → connexion directe, comme avant.
//  - 2+ comptes trouvés    → on ne peut pas deviner lequel l'utilisateur
//    veut ouvrir : on renvoie la liste des "espaces" (un par gérant) et un
//    jeton de sélection de courte durée (5 min) prouvant que l'OTP a bien
//    été validé, sans avoir à le redemander. Le client appelle ensuite
//    /member/login/select-space avec ce jeton + le tenantId choisi.
const memberLoginVerify = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) return error(res, 'Code incorrect ou expiré', 400);

    const users = await prisma.user.findMany({
      where: { phone: normalizedPhone, isActive: true },
      include: { tenant: true },
    });

    if (users.length === 0) return error(res, 'Code incorrect ou expiré', 400);

    if (users.length === 1) {
      const user = users[0];
      const accessToken = generateToken(user.id, 'user');
      const refreshToken = generateRefreshToken(user.id, 'user');
      return success(res, {
        user: { id: user.id, name: user.name, phone: user.phone },
        accessToken,
        refreshToken,
      }, 'Connexion réussie');
    }

    // ── Plusieurs comptes : demander à choisir l'espace (gérant).
    const selectionToken = jwt.sign(
      { phone: normalizedPhone, type: 'member_selection' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    return success(res, {
      requiresSelection: true,
      selectionToken,
      spaces: users.map((u) => ({
        tenantId: u.tenantId,
        tenantName: u.tenant.name,
        userId: u.id,
      })),
    }, 'Choisissez le compte à ouvrir');
  } catch (err) {
    console.error('memberLoginVerify error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Finaliser la connexion après choix de l'espace ─────────────
// Utilisé uniquement quand memberLoginVerify a renvoyé requiresSelection.
const memberLoginSelectSpace = async (req, res) => {
  try {
    const { selectionToken, tenantId } = req.body;
    if (!selectionToken || !tenantId) {
      return error(res, 'Requête invalide', 400);
    }

    let decoded;
    try {
      decoded = jwt.verify(selectionToken, process.env.JWT_SECRET);
    } catch (_) {
      return error(res, 'Session expirée, recommencez la connexion.', 401);
    }
    if (decoded.type !== 'member_selection') {
      return error(res, 'Jeton invalide', 400);
    }

    const user = await prisma.user.findUnique({
      where: { tenantId_phone: { tenantId, phone: decoded.phone } },
    });
    if (!user || !user.isActive) return error(res, 'Compte introuvable', 404);

    const accessToken = generateToken(user.id, 'user');
    const refreshToken = generateRefreshToken(user.id, 'user');

    return success(res, {
      user: { id: user.id, name: user.name, phone: user.phone },
      accessToken,
      refreshToken,
    }, 'Connexion réussie');
  } catch (err) {
    console.error('memberLoginSelectSpace error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Profil (lecture) ────────────────────────────────────────────
const getTenantProfile = async (req, res) => {
  return success(res, {
    id: req.tenant.id,
    name: req.tenant.name,
    phone: req.tenant.phone,
    photoUrl: req.tenant.photoUrl,
  });
};

// ─── GÉRANT : Profil ──────────────────────────────────────────────────────
const updateTenantProfile = async (req, res) => {
  try {
    const { name, photoUrl } = req.body;
    if (!name || name.trim().length < 2 || name.trim().length > 100) {
      return error(res, 'Nom invalide', 400);
    }
    const updated = await prisma.tenant.update({
      where: { id: req.tenant.id },
      data: { name: name.trim(), photoUrl },
    });
    return success(res, {
      id: updated.id, name: updated.name,
      phone: updated.phone, photoUrl: updated.photoUrl,
    }, 'Profil mis à jour');
  } catch (err) {
    console.error('updateTenantProfile error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Profil (lecture) ────────────────────────────────────────────
const getMemberProfile = async (req, res) => {
  return success(res, {
    id: req.user.id,
    name: req.user.name,
    phone: req.user.phone,
    photoUrl: req.user.photoUrl,
    tenantName: req.tenant.name,
  });
};

// ─── MEMBRE : Profil (mise à jour) ────────────────────────────────────────
// Un membre ne peut modifier que son nom et sa photo — jamais son
// téléphone directement ici (changer de numéro nécessiterait une nouvelle
// vérification OTP, hors scope de cet endpoint).
const updateMemberProfile = async (req, res) => {
  try {
    const { name, photoUrl } = req.body;
    if (!name || name.trim().length < 2 || name.trim().length > 100) {
      return error(res, 'Nom invalide', 400);
    }
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { name: name.trim(), photoUrl },
    });
    return success(res, {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      photoUrl: updated.photoUrl,
    }, 'Profil mis à jour');
  } catch (err) {
    console.error('updateMemberProfile error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

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
    console.error('tenantSetPin error:', err.message);
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
    console.error('tenantVerifyPin error:', err.message);
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
    console.error('tenantHasPin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

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
    console.error('tenantVerifyPinLocked error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

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
    console.error('userSetPin error:', err.message);
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
    console.error('userVerifyPin error:', err.message);
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
    console.error('userHasPin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : PIN session verrouillée ─────────────────────────────────────
const userVerifyPinLocked = async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) return error(res, 'PIN invalide', 400);

    const normalizedPhone = normalizePhone(phone);
    const user = await prisma.user.findFirst({
      where: { phone: normalizedPhone, isActive: true },
      select: { id: true, pinHash: true, name: true, phone: true },
    });

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
    console.error('userVerifyPinLocked error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  tenantRequestOTP,
  tenantVerifyAndRegister,
  tenantLoginRequestOTP,
  tenantLoginVerify,
  memberRequestOTP,
  memberVerifyAndJoin,
  memberLoginRequestOTP,
  memberLoginVerify,
  memberLoginSelectSpace,
  getTenantProfile,
  updateTenantProfile,
  getMemberProfile,
  updateMemberProfile,
  tenantSetPin,
  tenantVerifyPin,
  tenantHasPin,
  tenantVerifyPinLocked,
  userSetPin,
  userVerifyPin,
  userHasPin,
  userVerifyPinLocked,
};