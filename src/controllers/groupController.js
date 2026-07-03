// src/controllers/groupController.js
const prisma = require('../config/database');
const { success, error, created } = require('../utils/response');
const { generateInviteCode } = require('../utils/otp');
const { createNotification } = require('../services/notificationService');

// ─── CRÉER UN GROUPE ───────────────────────────────────────────────────────
const createGroup = async (req, res) => {
  try {
    const { name, type, frequency, amount, currency, description } = req.body;
    const tenantId = req.tenant.id;

    const inviteCode = generateInviteCode();

    const group = await prisma.group.create({
      data: {
        tenantId,
        name,
        type,
        frequency,
        amount: parseFloat(amount),
        currency: currency || 'XOF',
        description,
        inviteCode,
      },
    });

    return created(res, group, 'Groupe créé avec succès');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── LISTE DES GROUPES DU GÉRANT ──────────────────────────────────────────
const getGroups = async (req, res) => {
  try {
    const groups = await prisma.group.findMany({
      where: { tenantId: req.tenant.id },
      include: {
        _count: { select: { groupMembers: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return success(res, groups);
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── DÉTAIL D'UN GROUPE ────────────────────────────────────────────────────
const getGroup = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await prisma.group.findFirst({
      where: { id, tenantId: req.tenant.id },
      include: {
        groupMembers: {
          include: { user: true },
          orderBy: { orderTurn: 'asc' },
        },
        turns: {
          include: { user: true },
          orderBy: { turnNumber: 'asc' },
        },
      },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    return success(res, group);
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MODIFIER UN GROUPE ────────────────────────────────────────────────────
const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, frequency, amount, currency, description } = req.body;

    const group = await prisma.group.findFirst({
      where: { id, tenantId: req.tenant.id },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    const updated = await prisma.group.update({
      where: { id },
      data: {
        name,
        type,
        frequency,
        amount: amount ? parseFloat(amount) : undefined,
        currency,
        description,
      },
    });

    return success(res, updated, 'Groupe mis à jour');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── ARCHIVER UN GROUPE ────────────────────────────────────────────────────
const archiveGroup = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await prisma.group.findFirst({
      where: { id, tenantId: req.tenant.id },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    await prisma.group.update({
      where: { id },
      data: { isActive: false },
    });

    return success(res, null, 'Groupe archivé');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── VUE MEMBRE : Ses groupes ─────────────────────────────────────────────
const getMemberGroups = async (req, res) => {
  try {
    const userId = req.user.id;

    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            _count: { select: { groupMembers: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const groups = memberships.map((m) => ({
      ...m.group,
      orderTurn: m.orderTurn,
      joinedAt: m.joinedAt,
    }));

    return success(res, groups);
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  createGroup,
  getGroups,
  getGroup,
  updateGroup,
  archiveGroup,
  getMemberGroups,
};
