// src/controllers/memberController.js
const prisma = require('../config/database');
const { success, error, created } = require('../utils/response');
const { createNotification } = require('../services/notificationService');
const { getActiveCycle } = require('../services/cycleService');
const { logAction } = require('../services/auditService');

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

const addMember = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, phone } = req.body;
    const tenantId = req.tenant.id;

    const { normalizePhone } = require('../utils/phone');
    const normalizedPhone = normalizePhone(phone);

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId },
      include: { _count: { select: { groupMembers: true } } },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    if (group.maxMembers !== null && group._count.groupMembers >= group.maxMembers) {
      return error(res,
        `Groupe complet (${group._count.groupMembers}/${group.maxMembers} membres). Modifiez le nombre maximum pour ajouter des membres.`,
        400
      );
    }

    let user = await prisma.user.findUnique({
      where: { tenantId_phone: { tenantId, phone: normalizedPhone } },
    });
    if (!user) {
      user = await prisma.user.create({
        data: { tenantId, name, phone: normalizedPhone },
      });
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    });
    if (existing) return error(res, 'Ce membre est déjà dans le groupe', 409);

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

    await logAction({
      tenantId,
      groupId,
      actorType: 'TENANT',
      actorId: tenantId,
      actorName: req.tenant.name,
      action: 'MEMBER_ADDED',
      targetType: 'GroupMember',
      targetId: member.id,
      metadata: { memberName: member.user.name, phone: normalizedPhone, orderTurn: member.orderTurn },
    });

    return created(res, member, 'Membre ajouté avec succès');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

const updateMember = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { name, phone } = req.body;
    const tenantId = req.tenant.id;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) return error(res, 'Membre introuvable dans ce groupe', 404);

    const updateData = {};
    if (name) updateData.name = name;
    if (phone) {
      const { normalizePhone } = require('../utils/phone');
      updateData.phone = normalizePhone(phone);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    await logAction({
      tenantId,
      groupId,
      actorType: 'TENANT',
      actorId: tenantId,
      actorName: req.tenant.name,
      action: 'MEMBER_UPDATED',
      targetType: 'User',
      targetId: userId,
      metadata: { changes: updateData },
    });

    return success(res, updatedUser, 'Membre modifié avec succès');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

const removeMember = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      include: { user: true },
    });

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    });

    await logAction({
      tenantId: req.tenant.id,
      groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'MEMBER_REMOVED',
      targetType: 'User',
      targetId: userId,
      metadata: { memberName: membership?.user?.name ?? null },
    });

    return success(res, null, 'Membre retiré du groupe');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

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

    await logAction({
      tenantId: req.tenant.id,
      groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'TURN_ORDER_UPDATED',
      targetType: 'Group',
      targetId: groupId,
      metadata: { orders },
    });

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

    const activeCycle = await getActiveCycle(groupId);

    const turns = activeCycle
      ? await prisma.turn.findMany({
          where: { cycleId: activeCycle.id },
          include: { user: true },
          orderBy: { turnNumber: 'asc' },
        })
      : [];

    const now = new Date();
    const enrichedTurns = turns.map((t) => ({
      ...t,
      isLate: t.status !== 'DONE' && new Date(t.scheduledDate) < now,
    }));

    // ── Infos groupe (fréquence structurée, plus de texte libre à parser)
    const group = await prisma.group.findUnique({
      where: { id: groupId },
    });

    return success(res, {
      myTurn: membership.orderTurn,
      members,
      turns: enrichedTurns,
      cycleNumber: activeCycle?.cycleNumber ?? null,
      cycleStartDate: activeCycle?.startDate ?? null,
      cycleDueDate: activeCycle?.dueDate ?? null,
      group: {
        name: group.name,
        frequencyValue: group.frequencyValue,
        frequencyUnit: group.frequencyUnit,
        description: group.description,
        amount: group.amount,
        currency: group.currency,
      },
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  getMembers,
  addMember,
  updateMember,
  removeMember,
  updateTurnOrder,
  getMemberTurns,
};