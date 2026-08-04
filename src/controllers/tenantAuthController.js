// src/controllers/tenantAuthController.js — Inscription, connexion et profil du GÉRANT (tenant)
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
    logger.error('tenantRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Vérifier OTP inscription ────────────────────────────────────

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
    logger.error('tenantVerifyAndRegister error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Connexion OTP ────────────────────────────────────────────────

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
      logger.info(`ℹ️ tenantLoginRequestOTP: aucun tenant actif pour ${normalizedPhone} — aucun SMS envoyé (comportement anti-énumération)`);
      return success(res, null, 'Si ce numéro est enregistré, un code vous sera envoyé.');
    }

    await sendOTP(normalizedPhone);
    return success(res, null, 'Si ce numéro est enregistré, un code vous sera envoyé.');
  } catch (err) {
    logger.error('tenantLoginRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Vérifier OTP connexion ──────────────────────────────────────

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
    logger.error('tenantLoginVerify error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Rejoindre OTP ────────────────────────────────────────────────

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
    logger.error('updateTenantProfile error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Profil (lecture) ────────────────────────────────────────────

// ─── GÉRANT : Changement de numéro — étape 1 (envoi OTP au nouveau numéro) ─
const tenantChangePhoneRequestOTP = async (req, res) => {
  try {
    const { newPhone } = req.body;
    const normalized = normalizePhone(newPhone);

    if (!isValidPhone(normalized)) return error(res, 'Numéro invalide', 400);
    if (normalized === req.tenant.phone) {
      return error(res, 'C\'est déjà votre numéro actuel', 400);
    }

    const existing = await prisma.tenant.findUnique({ where: { phone: normalized } });
    if (existing) return error(res, 'Ce numéro est déjà utilisé par un autre compte', 409);

    const result = await sendOTP(normalized);
    if (!result.success) return error(res, 'Échec de l\'envoi du code', 500);

    return success(res, { dev_otp: result.dev_otp }, 'Code envoyé au nouveau numéro');
  } catch (err) {
    logger.error('tenantChangePhoneRequestOTP error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── GÉRANT : Changement de numéro — étape 2 (vérification + application) ─
// Une fois le numéro changé, tous les membres du gérant sont notifiés — le
// numéro du gérant sert de contact de référence pour eux, ils doivent le
// savoir immédiatement.

// ─── GÉRANT : Changement de numéro — étape 2 (vérification + application) ─
// Une fois le numéro changé, tous les membres du gérant sont notifiés — le
// numéro du gérant sert de contact de référence pour eux, ils doivent le
// savoir immédiatement.
const tenantChangePhoneVerify = async (req, res) => {
  try {
    const { newPhone, otp } = req.body;
    const normalized = normalizePhone(newPhone);

    const result = await verifyOTP(normalized, otp);
    if (!result.valid) return error(res, 'Code incorrect ou expiré', 400);

    // Re-vérification anti-course (deux changements simultanés vers le même numéro)
    const existing = await prisma.tenant.findUnique({ where: { phone: normalized } });
    if (existing) return error(res, 'Ce numéro est déjà utilisé par un autre compte', 409);

    const oldPhone = req.tenant.phone;
    const updated = await prisma.tenant.update({
      where: { id: req.tenant.id },
      data: { phone: normalized },
    });

    await logAction({
      tenantId: req.tenant.id,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'TENANT_PHONE_CHANGED',
      targetType: 'Tenant',
      targetId: req.tenant.id,
      metadata: { oldPhone, newPhone: normalized },
    });

    // Notifier tous les membres actifs du gérant.
    // Auparavant : boucle séquentielle (await dans un for...of), donc
    // latence cumulée = nombre de membres × (temps DB + temps FCM). Avec
    // Promise.allSettled, tous les envois partent en parallèle — et un
    // échec sur UN membre (token FCM invalide, etc.) n'empêche pas les
    // autres d'être notifiés (contrairement à Promise.all qui abandonnerait
    // tout au premier rejet).
    const members = await prisma.user.findMany({
      where: { tenantId: req.tenant.id, isActive: true },
    });
    await Promise.allSettled(members.map(async (member) => {
      await createNotification({
        tenantId: req.tenant.id,
        userId: member.id,
        type: 'GENERAL',
        title: 'Numéro du gérant mis à jour',
        message: `${req.tenant.name} a changé de numéro de téléphone.`,
      });
      if (member.fcmToken) {
        await sendPushNotification({
          token: member.fcmToken,
          title: 'Numéro du gérant mis à jour',
          body: `${req.tenant.name} a changé de numéro de téléphone.`,
          data: { type: 'GENERAL' },
        });
      }
    }));

    return success(res, {
      id: updated.id, name: updated.name, phone: updated.phone, photoUrl: updated.photoUrl,
    }, 'Numéro mis à jour');
  } catch (err) {
    logger.error('tenantChangePhoneVerify error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Changement de numéro — étape 1 ──────────────────────────────

// ─── GÉRANT : Suppression de compte ───────────────────────────────────────
// Anonymisation plutôt que suppression SQL brute : les groupes/cotisations
// restent en base (intégrité des historiques pour les membres, obligations
// comptables), mais toute information identifiante du gérant est effacée et
// le compte devient définitivement inutilisable. Confirmé par PIN — action
// irréversible, on ne se contente pas d'un bouton sans friction.
const tenantDeleteAccount = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) return error(res, 'PIN invalide', 400);
    if (!req.tenant.pinHash) {
      return error(res, 'Aucun PIN configuré sur ce compte — impossible de confirmer la suppression.', 400);
    }

    const validPin = await bcrypt.compare(pin, req.tenant.pinHash);
    if (!validPin) return error(res, 'PIN incorrect', 401);

    const originalName = req.tenant.name;
    const originalPhone = req.tenant.phone;
    const tenantId = req.tenant.id;

    // Annuler l'abonnement immédiatement (pas de remboursement au prorata —
    // cohérent avec la politique déjà en place pour l'annulation volontaire).
    try {
      await cancelSubscription({ tenant: req.tenant, immediate: true });
    } catch (_) {
      // Ne bloque pas la suppression si l'abonnement était déjà en FREE.
    }

    // Fermer tous les groupes du gérant — ils ne peuvent plus être gérés.
    const groups = await prisma.group.findMany({ where: { tenantId, isActive: true } });
    if (groups.length > 0) {
      await prisma.group.updateMany({
        where: { tenantId, isActive: true },
        data: { isActive: false },
      });
    }

    // Archiver les données d'origine AVANT anonymisation — trace de sécurité
    // interne (litige, fraude), jamais exposée par une route API.
    await prisma.deletedAccountArchive.create({
      data: {
        accountType: 'TENANT',
        accountId: tenantId,
        originalName,
        originalPhone,
        reason: 'self_service_app',
      },
    });

    // Anonymiser la fiche vivante (jamais de suppression SQL directe — le
    // détail d'origine reste dans DeletedAccountArchive ci-dessus).
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: 'Compte supprimé',
        phone: `deleted_${tenantId}`,
        photoUrl: null,
        pinHash: null,
        fcmToken: null,
        isActive: false,
        deletedAt: new Date(),
      },
    });

    await logAction({
      tenantId,
      actorType: 'TENANT',
      actorId: tenantId,
      actorName: originalName,
      action: 'TENANT_ACCOUNT_DELETED',
      targetType: 'Tenant',
      targetId: tenantId,
      metadata: { originalPhone },
    });

    // Prévenir tous les membres actifs que leurs groupes sont fermés.
    const members = await prisma.user.findMany({ where: { tenantId, isActive: true } });
    await Promise.allSettled(members.map(async (member) => {
      await createNotification({
        tenantId,
        userId: member.id,
        type: 'GENERAL',
        title: 'Compte du gérant supprimé',
        message: `${originalName} a supprimé son compte. Vos groupes avec ce gérant sont maintenant fermés.`,
      });
      if (member.fcmToken) {
        await sendPushNotification({
          token: member.fcmToken,
          title: 'Compte du gérant supprimé',
          body: `${originalName} a supprimé son compte. Vos groupes sont maintenant fermés.`,
          data: { type: 'GENERAL' },
        });
      }
    }));

    return success(res, null, 'Compte supprimé');
  } catch (err) {
    logger.error('tenantDeleteAccount error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MEMBRE : Suppression de compte ───────────────────────────────────────
// Ne supprime QUE l'appartenance à CE gérant (cf. un même numéro peut être
// membre chez plusieurs gérants, chacun via une ligne User distincte) — pas
// les autres comptes membre éventuels sous d'autres gérants.

module.exports = {
  tenantRequestOTP,
  tenantVerifyAndRegister,
  tenantLoginRequestOTP,
  tenantLoginVerify,
  getTenantProfile,
  updateTenantProfile,
  tenantChangePhoneRequestOTP,
  tenantChangePhoneVerify,
  tenantDeleteAccount,
};
