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

    // Vérifier si un compte existe déjà
    const existing = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });

    if (existing) {
      return error(res, 'Ce numéro est déjà enregistré. Utilisez la connexion.', 409);
    }

    // Stocker temporairement le nom en attendant la vérification
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
    if (!result.valid) {
      return error(res, result.reason, 400);
    }

    // Récupérer les données en attente
    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const pendingData = await redis.get(`pending_tenant:${normalizedPhone}`);

    if (!pendingData) {
      return error(res, 'Session expirée. Recommencez l\'inscription.', 400);
    }

    const { name } = JSON.parse(pendingData);
    await redis.del(`pending_tenant:${normalizedPhone}`);

    // Créer le compte gérant
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

    if (!tenant) {
      return error(res, 'Aucun compte trouvé avec ce numéro', 404);
    }

    if (!tenant.isActive) {
      return error(res, 'Compte désactivé', 403);
    }

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
    if (!result.valid) {
      return error(res, result.reason, 400);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { phone: normalizedPhone },
    });

    if (!tenant) {
      return error(res, 'Compte introuvable', 404);
    }

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

    // Vérifier que le groupe existe
    const group = await prisma.group.findUnique({ where: { inviteCode } });
    if (!group) {
      return error(res, 'Code d\'invitation invalide', 404);
    }

    // Stocker données en attente
    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    await redis.setEx(
      `pending_member:${normalizedPhone}`,
      600,
      JSON.stringify({ name, inviteCode, tenantId: group.tenantId, groupId: group.id })
    );

    await sendOTP(normalizedPhone);

    return success(res, { groupName: group.name }, `Code envoyé au ${normalizedPhone}`);
  } catch (err) {
    console.error(err);
    return error(res, err.message || 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Vérifier OTP et rejoindre le groupe ─────────────────────────
const memberVerifyAndJoin = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const result = await verifyOTP(normalizedPhone, otp);
    if (!result.valid) {
      return error(res, result.reason, 400);
    }

    const { getRedisClient } = require('../config/redis');
    const redis = await getRedisClient();
    const pendingData = await redis.get(`pending_member:${normalizedPhone}`);

    if (!pendingData) {
      return error(res, 'Session expirée. Recommencez.', 400);
    }

    const { name, tenantId, groupId } = JSON.parse(pendingData);
    await redis.del(`pending_member:${normalizedPhone}`);

    // Créer ou récupérer le membre
    let user = await prisma.user.findUnique({
      where: { tenantId_phone: { tenantId, phone: normalizedPhone } },
    });

    if (!user) {
      user = await prisma.user.create({
        data: { tenantId, name, phone: normalizedPhone },
      });
    }

    // Ajouter au groupe si pas déjà membre
    const existingMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    });

    if (!existingMember) {
      // Calculer le prochain order_turn
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

// ─── MEMBRE : Connexion directe (téléphone existant) ──────────────────────
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

    if (!user) {
      return error(res, 'Aucun compte membre trouvé avec ce numéro', 404);
    }

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
    if (!result.valid) {
      return error(res, result.reason, 400);
    }

    const user = await prisma.user.findFirst({
      where: { phone: normalizedPhone, isActive: true },
      include: { tenant: true },
    });

    if (!user) {
      return error(res, 'Compte introuvable', 404);
    }

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

// ─── PROFIL : Mettre à jour ────────────────────────────────────────────────
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
};
