// src/controllers/memberController.js
const prisma = require('../config/database');
const { success, error, created } = require('../utils/response');
const { createNotification } = require('../services/notificationService');

// ─── LISTE DES MEMBRES D'UN GROUPE ────────────────────────────────────────
const getMembers = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
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

    // Récupérer groupe avec comptage membres
    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId },
      include: { _count: { select: { groupMembers: true } } },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    // ── Vérifier si groupe plein
    if (group.maxMembers !== null && group._count.groupMembers >= group.maxMembers) {
      return error(res,
        `Groupe complet (${group._count.groupMembers}/${group.maxMembers} membres). Modifiez le nombre maximum pour ajouter des membres.`,
        400
      );
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
    if (existing) return error(res, 'Ce membre est déjà dans le groupe', 409);

    // Prochain tour
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

    // Notifier le membre
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
    if (!group) return error(res, 'Groupe introuvable', 404);

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
    const { orders } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

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

// ─── VUE MEMBRE : Voir son tour ────────────────────────────────────────────
const getMemberTurns = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) return error(res, 'Vous n\'êtes pas membre de ce groupe', 403);

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
