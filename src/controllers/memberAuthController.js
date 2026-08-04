// src/controllers/memberAuthController.js — Inscription, connexion et profil du MEMBRE
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
    logger.error('memberRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Vérifier OTP rejoindre ──────────────────────────────────────

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
    logger.error('memberVerifyAndJoin error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Connexion OTP ────────────────────────────────────────────────

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
      logger.info(`ℹ️ memberLoginRequestOTP: aucun user actif pour ${normalizedPhone} — aucun SMS envoyé (comportement anti-énumération)`);
      return success(res, null, 'Si ce numéro est enregistré, un code vous sera envoyé.');
    }

    await sendOTP(normalizedPhone);
    return success(res, null, 'Si ce numéro est enregistré, un code vous sera envoyé.');
  } catch (err) {
    logger.error('memberLoginRequestOTP error:', err.message);
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
    logger.error('memberLoginVerify error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Finaliser la connexion après choix de l'espace ─────────────
// Utilisé uniquement quand memberLoginVerify a renvoyé requiresSelection.

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
    logger.error('memberLoginSelectSpace error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Profil (lecture) ────────────────────────────────────────────

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
    logger.error('updateMemberProfile error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Changement de numéro — étape 1 (envoi OTP au nouveau numéro) ─

// ─── MEMBRE : Changement de numéro — étape 1 ──────────────────────────────
const memberChangePhoneRequestOTP = async (req, res) => {
  try {
    const { newPhone } = req.body;
    const normalized = normalizePhone(newPhone);

    if (!isValidPhone(normalized)) return error(res, 'Numéro invalide', 400);
    if (normalized === req.user.phone) {
      return error(res, 'C\'est déjà votre numéro actuel', 400);
    }

    // Unicité par tenant uniquement (le même numéro peut exister chez un
    // autre gérant — cf. @@unique([tenantId, phone])).
    const existing = await prisma.user.findUnique({
      where: { tenantId_phone: { tenantId: req.user.tenantId, phone: normalized } },
    });
    if (existing) return error(res, 'Ce numéro est déjà utilisé dans ce groupe', 409);

    const result = await sendOTP(normalized);
    if (!result.success) return error(res, 'Échec de l\'envoi du code', 500);

    return success(res, { dev_otp: result.dev_otp }, 'Code envoyé au nouveau numéro');
  } catch (err) {
    logger.error('memberChangePhoneRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Changement de numéro — étape 2 ──────────────────────────────
// Notifie le gérant (c'est lui qui gère les contributions/paiements avec ce
// numéro) ET les autres membres des groupes partagés avec ce membre.

// ─── MEMBRE : Changement de numéro — étape 2 ──────────────────────────────
// Notifie le gérant (c'est lui qui gère les contributions/paiements avec ce
// numéro) ET les autres membres des groupes partagés avec ce membre.
const memberChangePhoneVerify = async (req, res) => {
  try {
    const { newPhone, otp } = req.body;
    const normalized = normalizePhone(newPhone);

    const result = await verifyOTP(normalized, otp);
    if (!result.valid) return error(res, 'Code incorrect ou expiré', 400);

    const existing = await prisma.user.findUnique({
      where: { tenantId_phone: { tenantId: req.user.tenantId, phone: normalized } },
    });
    if (existing) return error(res, 'Ce numéro est déjà utilisé dans ce groupe', 409);

    const oldPhone = req.user.phone;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { phone: normalized },
    });

    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });

    await logAction({
      tenantId: req.user.tenantId,
      actorType: 'USER',
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'MEMBER_PHONE_CHANGED',
      targetType: 'User',
      targetId: req.user.id,
      metadata: { oldPhone, newPhone: normalized },
    });

    // Notifier le gérant.
    if (tenant?.fcmToken) {
      await sendPushNotification({
        token: tenant.fcmToken,
        title: 'Numéro membre mis à jour',
        body: `${updated.name} a changé de numéro de téléphone.`,
        data: { type: 'GENERAL' },
      });
    }

    // Notifier les autres membres des groupes partagés (co-équipiers de tontine).
    const sharedGroupIds = (await prisma.groupMember.findMany({
      where: { userId: req.user.id },
      select: { groupId: true },
    })).map((g) => g.groupId);

    if (sharedGroupIds.length > 0) {
      const coMembers = await prisma.groupMember.findMany({
        where: { groupId: { in: sharedGroupIds }, userId: { not: req.user.id } },
        select: { userId: true },
        distinct: ['userId'],
      });
      const coMemberUsers = await prisma.user.findMany({
        where: { id: { in: coMembers.map((c) => c.userId) } },
      });
      await Promise.allSettled(coMemberUsers.map(async (co) => {
        await createNotification({
          tenantId: req.user.tenantId,
          userId: co.id,
          type: 'GENERAL',
          title: 'Numéro d\'un membre mis à jour',
          message: `${updated.name} a changé de numéro de téléphone.`,
        });
        if (co.fcmToken) {
          await sendPushNotification({
            token: co.fcmToken,
            title: 'Numéro d\'un membre mis à jour',
            body: `${updated.name} a changé de numéro de téléphone.`,
            data: { type: 'GENERAL' },
          });
        }
      }));
    }

    return success(res, {
      id: updated.id, name: updated.name, phone: updated.phone, photoUrl: updated.photoUrl,
    }, 'Numéro mis à jour');
  } catch (err) {
    logger.error('memberChangePhoneVerify error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Suppression de compte ───────────────────────────────────────
// Anonymisation plutôt que suppression SQL brute : les groupes/cotisations
// restent en base (intégrité des historiques pour les membres, obligations
// comptables), mais toute information identifiante du gérant est effacée et
// le compte devient définitivement inutilisable. Confirmé par PIN — action
// irréversible, on ne se contente pas d'un bouton sans friction.

// ─── MEMBRE : Suppression de compte ───────────────────────────────────────
// Ne supprime QUE l'appartenance à CE gérant (cf. un même numéro peut être
// membre chez plusieurs gérants, chacun via une ligne User distincte) — pas
// les autres comptes membre éventuels sous d'autres gérants.
const memberDeleteAccount = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) return error(res, 'PIN invalide', 400);
    if (!req.user.pinHash) {
      return error(res, 'Aucun PIN configuré sur ce compte — impossible de confirmer la suppression.', 400);
    }

    const validPin = await bcrypt.compare(pin, req.user.pinHash);
    if (!validPin) return error(res, 'PIN incorrect', 401);

    const originalName = req.user.name;
    const originalPhone = req.user.phone;
    const userId = req.user.id;
    const tenantId = req.user.tenantId;

    // Archiver les données d'origine AVANT anonymisation — trace de sécurité
    // interne, jamais exposée par une route API.
    await prisma.deletedAccountArchive.create({
      data: {
        accountType: 'USER',
        accountId: userId,
        originalName,
        originalPhone,
        tenantId,
        reason: 'self_service_app',
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        name: 'Membre supprimé',
        phone: `deleted_${userId}`,
        photoUrl: null,
        pinHash: null,
        fcmToken: null,
        isActive: false,
        deletedAt: new Date(),
      },
    });

    await logAction({
      tenantId,
      actorType: 'USER',
      actorId: userId,
      actorName: originalName,
      action: 'MEMBER_ACCOUNT_DELETED',
      targetType: 'User',
      targetId: userId,
      metadata: { originalPhone },
    });

    // Prévenir le gérant.
    if (req.tenant?.fcmToken) {
      await sendPushNotification({
        token: req.tenant.fcmToken,
        title: 'Un membre a supprimé son compte',
        body: `${originalName} a supprimé son compte.`,
        data: { type: 'GENERAL' },
      });
    }

    return success(res, null, 'Compte supprimé');
  } catch (err) {
    logger.error('memberDeleteAccount error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : PIN ─────────────────────────────────────────────────────────

module.exports = {
  memberRequestOTP,
  memberVerifyAndJoin,
  memberLoginRequestOTP,
  memberLoginVerify,
  memberLoginSelectSpace,
  getMemberProfile,
  updateMemberProfile,
  memberChangePhoneRequestOTP,
  memberChangePhoneVerify,
  memberDeleteAccount,
};
