// src/controllers/contributionController.js
const prisma = require('../config/database');
const { success, error, created } = require('../utils/response');
const { notifyTurnReceived } = require('../services/notificationService');
const { getActiveCycle, getOrCreateActiveCycle } = require('../services/cycleService');
const { logAction } = require('../services/auditService');

// ─── CRÉER UN CYCLE DE COTISATIONS ────────────────────────────────────────
const createCycleContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { dueDate } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
    });

    if (members.length === 0) {
      return error(res, 'Aucun membre dans ce groupe', 400);
    }

    const cycle = await getOrCreateActiveCycle(groupId);

    // ── Empêcher de créer une nouvelle collecte si la précédente
    // de ce même cycle n'est pas encore terminée
    const pendingInCycle = await prisma.contribution.count({
      where: { cycleId: cycle.id, status: { in: ['PENDING', 'LATE'] } },
    });
    if (pendingInCycle > 0) {
      return error(res,
        `Des cotisations du cycle N°${cycle.cycleNumber} sont encore en attente ou en retard. Terminez-les avant d'en créer de nouvelles.`,
        409
      );
    }

    const contributions = await prisma.$transaction(
      members.map((m) =>
        prisma.contribution.create({
          data: {
            groupId,
            userId: m.userId,
            cycleId: cycle.id,
            amount: group.amount,
            dueDate: new Date(dueDate),
            status: 'PENDING',
          },
        })
      )
    );

    await logAction({
      tenantId: req.tenant.id,
      groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'CYCLE_CONTRIBUTIONS_CREATED',
      targetType: 'Cycle',
      targetId: cycle.id,
      metadata: { cycleNumber: cycle.cycleNumber, count: contributions.length, dueDate },
    });

    return created(res, contributions,
      `${contributions.length} cotisations créées avec succès (Cycle N°${cycle.cycleNumber})`);
  } catch (err) {
    console.error('createCycleContributions error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── LISTE DES COTISATIONS ─────────────────────────────────────────────────
const getContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { status, cycleId } = req.query;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    // ── Par défaut, on ne montre que le cycle actif (sinon le cycle demandé)
    let targetCycleId = cycleId;
    if (!targetCycleId) {
      const active = await getActiveCycle(groupId);
      targetCycleId = active?.id ?? null;
    }

    const where = { groupId };
    if (targetCycleId) where.cycleId = targetCycleId;
    if (status) where.status = status;

    const contributions = await prisma.contribution.findMany({
      where,
      include: { user: true },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
    });

    return success(res, contributions);
  } catch (err) {
    console.error('getContributions error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER UNE COTISATION REÇUE ─────────────────────────────────────────
const markContributionReceived = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: { group: true },
    });

    if (!contribution) return error(res, 'Cotisation introuvable', 404);
    if (contribution.group.tenantId !== req.tenant.id) {
      return error(res, 'Non autorisé', 403);
    }

    const updated = await prisma.contribution.update({
      where: { id },
      data: {
        status: 'RECEIVED',
        paidDate: new Date(),
        note: note || null,
      },
      include: { user: true },
    });

    await logAction({
      tenantId: req.tenant.id,
      groupId: contribution.groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'CONTRIBUTION_MARKED_RECEIVED',
      targetType: 'Contribution',
      targetId: updated.id,
      metadata: { memberName: updated.user.name, amount: updated.amount, note: note || null },
    });

    return success(res, updated, 'Cotisation marquée comme reçue');
  } catch (err) {
    console.error('markContributionReceived error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER UNE COTISATION EN RETARD ─────────────────────────────────────
const markContributionLate = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: { group: true },
    });

    if (!contribution) return error(res, 'Cotisation introuvable', 404);
    if (contribution.group.tenantId !== req.tenant.id) {
      return error(res, 'Non autorisé', 403);
    }

    const updated = await prisma.contribution.update({
      where: { id },
      data: {
        status: 'LATE',
        note: note || null,
      },
      include: { user: true },
    });

    await logAction({
      tenantId: req.tenant.id,
      groupId: contribution.groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'CONTRIBUTION_MARKED_LATE',
      targetType: 'Contribution',
      targetId: updated.id,
      metadata: { memberName: updated.user.name, amount: updated.amount, note: note || null },
    });

    return success(res, updated, 'Cotisation marquée en retard');
  } catch (err) {
    console.error('markContributionLate error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── COTISATIONS DU MEMBRE ─────────────────────────────────────────────────
const getMemberContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) return error(res, 'Vous n\'êtes pas membre de ce groupe', 403);

    const contributions = await prisma.contribution.findMany({
      where: { groupId, userId },
      orderBy: { dueDate: 'desc' },
    });

    return success(res, contributions);
  } catch (err) {
    console.error('getMemberContributions error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── LISTE DES TOURS ───────────────────────────────────────────────────────
const getGroupTurns = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const activeCycle = await getActiveCycle(groupId);

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { orderTurn: 'asc' },
    });

    const turns = activeCycle
      ? await prisma.turn.findMany({
          where: { cycleId: activeCycle.id },
          include: { user: true },
          orderBy: { turnNumber: 'asc' },
        })
      : [];

    const receivedUserIds = turns
      .filter(t => t.status === 'DONE')
      .map(t => t.userId);

    const pendingMembers = members.filter(
      m => !receivedUserIds.includes(m.userId)
    );

    return success(res, {
      turns,
      pendingMembers,
      receivedCount: receivedUserIds.length,
      totalMembers: members.length,
      cycleNumber: activeCycle?.cycleNumber ?? null,
      cycleId: activeCycle?.id ?? null,
      allReceived: members.length > 0 && pendingMembers.length === 0,
    });
  } catch (err) {
    console.error('getGroupTurns error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER UN TOUR REÇU ─────────────────────────────────────────────────
const markTurnReceived = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId, turnNumber } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) return error(res, 'Membre introuvable dans ce groupe', 404);

    const cycle = await getOrCreateActiveCycle(groupId);

    const turn = await prisma.turn.upsert({
      where: { cycleId_turnNumber: { cycleId: cycle.id, turnNumber } },
      update: { status: 'DONE', userId },
      create: {
        groupId,
        userId,
        cycleId: cycle.id,
        turnNumber,
        scheduledDate: new Date(),
        status: 'DONE',
      },
      include: { user: true },
    });

    // Notifier le membre (push + notification en base)
    await notifyTurnReceived({
      tenantId: req.tenant.id,
      group,
      user: turn.user,
      turnNumber,
    });

    await logAction({
      tenantId: req.tenant.id,
      groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'TURN_MARKED_RECEIVED',
      targetType: 'Turn',
      targetId: turn.id,
      metadata: { memberName: turn.user.name, turnNumber, cycleNumber: cycle.cycleNumber },
    });

    return success(res, turn,
      `${turn.user.name} a bien reçu sa mise — Tour N°${turnNumber} (Cycle N°${cycle.cycleNumber})`);
  } catch (err) {
    console.error('markTurnReceived error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  createCycleContributions,
  getContributions,
  markContributionReceived,
  markContributionLate,
  getMemberContributions,
  getGroupTurns,
  markTurnReceived,
};