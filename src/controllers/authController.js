// src/controllers/authController.js
const prisma = require('../config/database');
const { sendOTP, verifyOTP } = require('../services/otpService');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const { success, error, created } = require('../utils/response');
const { normalizePhone, isValidPhone } = require('../utils/phone');

// ─── GÉRANT : Demander OTP pour inscription ────────────────────────────────
const tenantRequestOTP = async (req, res) => {
  try {
    const { phone, name } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!isValidPhone(normalizedPhone)) {
      return error(res, 'Numéro de téléphone invalide', 400);
    }

    const existing = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });
    if (existing) {
      return error(res, 'Ce numéro est déjà enregistré. Utilisez la connexion.', 409);
    }

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    await redis.setEx(`pending_tenant:${normalizedPhone}`, 600, JSON.stringify({ name }));

    await sendOTP(normalizedPhone);

    return success(res, null, `Code envoyé au ${normalizedPhone}`);
  } catch (err) {
    console.error(err);
    return error(res, err.message || 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Vérifier OTP et créer le compte ─────────────────────────────
const tenantVerifyAndRegister = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) return error(res, result.reason, 400);

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const pendingData = await redis.get(`pending_tenant:${normalizedPhone}`);
    if (!pendingData) return error(res, 'Session expirée. Recommencez l\'inscription.', 400);

    const { name } = JSON.parse(pendingData);
    await redis.del(`pending_tenant:${normalizedPhone}`);

    const tenant = await prisma.tenant.create({
      data: { name, phone: normalizedPhone },
    });

    const accessToken = generateToken(tenant.id, 'tenant');
    const refreshToken = generateRefreshToken(tenant.id, 'tenant');

    return created(res, {
      tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone },
      accessToken,
      refreshToken,
    }, 'Compte gérant créé avec succès');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Demander OTP pour connexion ─────────────────────────────────
const tenantLoginRequestOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!isValidPhone(normalizedPhone)) {
      return error(res, 'Numéro de téléphone invalide', 400);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });
    if (!tenant) return error(res, 'Aucun compte trouvé avec ce numéro', 404);
    if (!tenant.isActive) return error(res, 'Compte désactivé', 403);

    await sendOTP(normalizedPhone);

    return success(res, null, `Code envoyé au ${normalizedPhone}`);
  } catch (err) {
    console.error(err);
    return error(res, err.message || 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Vérifier OTP et se connecter ────────────────────────────────
const tenantLoginVerify = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) return error(res, result.reason, 400);

    const tenant = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });
    if (!tenant) return error(res, 'Compte introuvable', 404);

    const accessToken = generateToken(tenant.id, 'tenant');
    const refreshToken = generateRefreshToken(tenant.id, 'tenant');

    return success(res, {
      tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, photoUrl: tenant.photoUrl },
      accessToken,
      refreshToken,
    }, 'Connexion réussie');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Rejoindre via code + OTP ────────────────────────────────────
const memberRequestOTP = async (req, res) => {
  try {
    const { phone, name, inviteCode } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!isValidPhone(normalizedPhone)) {
      return error(res, 'Numéro de téléphone invalide', 400);
    }

    const group = await prisma.group.findUnique({
      where: { inviteCode },
      include: { _count: { select: { groupMembers: true } } },
    });
    if (!group) return error(res, 'Code d\'invitation invalide', 404);
    if (!group.isActive) return error(res, 'Ce groupe n\'est plus actif', 400);

    // ── Vérifier si groupe plein avant même d'envoyer l'OTP
    if (group.maxMembers !== null && group._count.groupMembers >= group.maxMembers) {
      return error(res, 'Ce groupe est complet. Contactez le gérant pour augmenter la capacité.', 400);
    }

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    await redis.setEx(
      `pending_member:${normalizedPhone}`,
      600,
      JSON.stringify({ name, inviteCode, tenantId: group.tenantId, groupId: group.id })
    );

    await sendOTP(normalizedPhone);

    return success(res, {
      groupName: group.name,
      membersCount: group._count.groupMembers,
      maxMembers: group.maxMembers,
    }, `Code envoyé au ${normalizedPhone}`);
  } catch (err) {
    console.error(err);
    return error(res, err.message || 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Vérifier OTP et rejoindre ───────────────────────────────────
const memberVerifyAndJoin = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) return error(res, result.reason, 400);

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const pendingData = await redis.get(`pending_member:${normalizedPhone}`);
    if (!pendingData) return error(res, 'Session expirée. Recommencez.', 400);

    const { name, tenantId, groupId } = JSON.parse(pendingData);
    await redis.del(`pending_member:${normalizedPhone}`);

    // ── Re-vérifier si groupe plein au moment de la vérification
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { _count: { select: { groupMembers: true } } },
    });

    if (!group) return error(res, 'Groupe introuvable', 404);

    if (group.maxMembers !== null && group._count.groupMembers >= group.maxMembers) {
      return error(res, 'Ce groupe est complet. Contactez le gérant.', 400);
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
        data: {
          groupId,
          userId: user.id,
          orderTurn: (maxTurn._max.orderTurn || 0) + 1,
        },
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
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Connexion directe ────────────────────────────────────────────
const memberLoginRequestOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!isValidPhone(normalizedPhone)) {
      return error(res, 'Numéro de téléphone invalide', 400);
    }

    const user = await prisma.user.findFirst({
      where: { phone: normalizedPhone, isActive: true },
    });
    if (!user) return error(res, 'Aucun compte membre trouvé avec ce numéro', 404);

    await sendOTP(normalizedPhone);

    return success(res, null, `Code envoyé au ${normalizedPhone}`);
  } catch (err) {
    console.error(err);
    return error(res, err.message || 'Erreur serveur', 500);
  }
};

const memberLoginVerify = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) return error(res, result.reason, 400);

    const user = await prisma.user.findFirst({
      where: { phone: normalizedPhone, isActive: true },
      include: { tenant: true },
    });
    if (!user) return error(res, 'Compte introuvable', 404);

    const accessToken = generateToken(user.id, 'user');
    const refreshToken = generateRefreshToken(user.id, 'user');

    return success(res, {
      user: { id: user.id, name: user.name, phone: user.phone },
      accessToken,
      refreshToken,
    }, 'Connexion réussie');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── PROFIL GÉRANT ────────────────────────────────────────────────────────
const updateTenantProfile = async (req, res) => {
  try {
    const { name, photoUrl } = req.body;
    const updated = await prisma.tenant.update({
      where: { id: req.tenant.id },
      data: { name, photoUrl },
    });

    return success(res, {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      photoUrl: updated.photoUrl,
    }, 'Profil mis à jour');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};


const bcrypt = require('bcryptjs');

// ─── GÉRANT : Définir/Modifier le PIN ─────────────────────────────────────
const tenantSetPin = async (req, res) => {
  try {
    const { pin } = req.body;

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return error(res, 'Le PIN doit être 4 chiffres', 400);
    }

    const pinHash = await bcrypt.hash(pin, 10);

    await prisma.tenant.update({
      where: { id: req.tenant.id },
      data: { pinHash },
    });

    return success(res, null, 'PIN défini avec succès');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Vérifier le PIN ──────────────────────────────────────────────
const tenantVerifyPin = async (req, res) => {
  try {
    const { pin } = req.body;

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenant.id },
    });

    if (!tenant.pinHash) {
      return error(res, 'Aucun PIN défini', 404);
    }

    const isValid = await bcrypt.compare(pin, tenant.pinHash);

    if (!isValid) {
      return error(res, 'PIN incorrect', 401);
    }

    return success(res, null, 'PIN valide');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Vérifier si PIN existe ──────────────────────────────────────
const tenantHasPin = async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenant.id },
    });

    return success(res, { hasPin: !!tenant.pinHash });
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Définir/Modifier le PIN ─────────────────────────────────────
const userSetPin = async (req, res) => {
  try {
    const { pin } = req.body;

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return error(res, 'Le PIN doit être 4 chiffres', 400);
    }

    const pinHash = await bcrypt.hash(pin, 10);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { pinHash },
    });

    return success(res, null, 'PIN défini avec succès');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Vérifier le PIN ──────────────────────────────────────────────
const userVerifyPin = async (req, res) => {
  try {
    const { pin } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user.pinHash) {
      return error(res, 'Aucun PIN défini', 404);
    }

    const isValid = await bcrypt.compare(pin, user.pinHash);

    if (!isValid) {
      return error(res, 'PIN incorrect', 401);
    }

    return success(res, null, 'PIN valide');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Vérifier si PIN existe ──────────────────────────────────────
const userHasPin = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    return success(res, { hasPin: !!user.pinHash });
  } catch (err) {
    console.error(err);
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
  updateTenantProfile,
  tenantSetPin,
  tenantVerifyPin,
  tenantHasPin,
  userSetPin,
  userVerifyPin,
  userHasPin,
};
