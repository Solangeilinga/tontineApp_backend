// src/controllers/memberController.js
const prisma = require('../config/database');
const { success, error, created } = require('../utils/response');
const { createNotification } = require('../services/notificationService');

// ─── LISTE DES MEMBRES D'UN GROUPE ────────────────────────────────────────
const getMembers = async (req, res) => {
  try {
    const { groupId } = req.params;

    // Vérifier que le groupe appartient au gérant
    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: {
        user: true,
      },
      orderBy: { orderTurn: 'asc' },
    });

    return success(res, members);
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── AJOUTER UN MEMBRE MANUELLEMENT ───────────────────────────────────────
const addMember = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, phone } = req.body;
    const tenantId = req.tenant.id;

    const { normalizePhone } = require('../utils/phone');
    const normalizedPhone = normalizePhone(phone);

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    // Créer ou récupérer l'utilisateur
    let user = await prisma.user.findUnique({
      where: { tenantId_phone: { tenantId, phone: normalizedPhone } },
    });

    if (!user) {
      user = await prisma.user.create({
        data: { tenantId, name, phone: normalizedPhone },
      });
    }

    // Vérifier qu'il n'est pas déjà membre
    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    });

    if (existing) {
      return error(res, 'Ce membre est déjà dans le groupe', 409);
    }

    // Calculer le prochain tour
    const maxTurn = await prisma.groupMember.aggregate({
      where: { groupId },
      _max: { orderTurn: true },
    });

    const member = await prisma.groupMember.create({
      data: {
        groupId,
        userId: user.id,
        orderTurn: (maxTurn._max.orderTurn || 0) + 1,
      },
      include: { user: true },
    });

    // Notifier le membre s'il a un token FCM
    if (user.fcmToken) {
      await createNotification({
        tenantId,
        userId: user.id,
        type: 'MEMBER_JOINED',
        title: `Bienvenue dans ${group.name}`,
        message: `Vous avez été ajouté au groupe de tontine "${group.name}"`,
        data: { groupId },
        fcmToken: user.fcmToken,
      });
    }

    return created(res, member, 'Membre ajouté avec succès');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── RETIRER UN MEMBRE ─────────────────────────────────────────────────────
const removeMember = async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    });

    return success(res, null, 'Membre retiré du groupe');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MODIFIER L'ORDRE DES TOURS ───────────────────────────────────────────
const updateTurnOrder = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { orders } = req.body; // [{ userId, orderTurn }]

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    // Mise à jour en transaction
    await prisma.$transaction(
      orders.map(({ userId, orderTurn }) =>
        prisma.groupMember.update({
          where: { groupId_userId: { groupId, userId } },
          data: { orderTurn },
        })
      )
    );

    return success(res, null, 'Ordre des tours mis à jour');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── VUE MEMBRE : Voir son tour et ceux des autres ────────────────────────
const getMemberTurns = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Vérifier qu'il est membre du groupe
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (!membership) {
      return error(res, 'Vous n\'êtes pas membre de ce groupe', 403);
    }

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { orderTurn: 'asc' },
    });

    const turns = await prisma.turn.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { turnNumber: 'asc' },
    });

    return success(res, {
      myTurn: membership.orderTurn,
      members,
      turns,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  getMembers,
  addMember,
  removeMember,
  updateTurnOrder,
  getMemberTurns,
};
