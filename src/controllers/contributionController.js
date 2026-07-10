// src/controllers/contributionController.js
const prisma = require('../config/database');
const { success, error } = require('../utils/response');
const { notifyTurnReceived } = require('../services/notificationService');
const { getActiveCycle } = require('../services/cycleService');
const { logAction } = require('../services/auditService');

// ─── LISTE DES COTISATIONS ─────────────────────────────────────────────────
const getContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { status, cycleId, roundNumber } = req.query;

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
    if (roundNumber) where.roundNumber = parseInt(roundNumber);
    if (status) where.status = status;

    const contributions = await prisma.contribution.findMany({
      where,
      include: { user: true },
      orderBy: [{ roundNumber: 'asc' }, { dueDate: 'asc' }],
    });

    const now = new Date();
    const enriched = contributions.map((c) => ({
      ...c,
      isLate: c.status === 'PENDING' && new Date(c.dueDate) < now,
    }));

    return success(res, enriched);
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
      metadata: {
        memberName: updated.user.name,
        amount: updated.amount,
        roundNumber: updated.roundNumber,
        note: note || null,
      },
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
      metadata: {
        memberName: updated.user.name,
        amount: updated.amount,
        roundNumber: updated.roundNumber,
        note: note || null,
      },
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
      where: { groupId, userId, hiddenForMember: false },
      orderBy: [{ roundNumber: 'asc' }, { dueDate: 'asc' }],
    });

    const now = new Date();
    const enriched = contributions.map((c) => ({
      ...c,
      isLate: c.status === 'PENDING' && new Date(c.dueDate) < now,
    }));

    return success(res, enriched);
  } catch (err) {
    console.error('getMemberContributions error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MASQUER UNE COTISATION DE MON HISTORIQUE (suppression douce) ────────
// Ne retire l'entrée QUE de la vue personnelle du membre. La cotisation
// reste intacte et continue de compter normalement dans les vues et
// statistiques du gérant (liste des cotisations, récap de cycle).
const hideMemberContribution = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const contribution = await prisma.contribution.findFirst({
      where: { id, userId },
    });
    if (!contribution) return error(res, 'Cotisation introuvable', 404);

    await prisma.contribution.update({
      where: { id },
      data: { hiddenForMember: true },
    });

    return success(res, null, 'Retiré de votre historique');
  } catch (err) {
    console.error('hideMemberContribution error:', err.message);
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

    const totalMembers = await prisma.groupMember.count({ where: { groupId } });
    const activeCycle = await getActiveCycle(groupId);

    if (!activeCycle) {
      return success(res, {
        turns: [],
        cycleNumber: null,
        cycleStartDate: null,
        cycleDueDate: null,
        receivedCount: 0,
        totalMembers,
        allReceived: false,
      });
    }

    const turns = await prisma.turn.findMany({
      where: { cycleId: activeCycle.id },
      include: { user: true },
      orderBy: { turnNumber: 'asc' },
    });

    const now = new Date();
    const enrichedTurns = turns.map((t) => ({
      ...t,
      isLate: t.status !== 'DONE' && new Date(t.scheduledDate) < now,
    }));

    const receivedCount = turns.filter((t) => t.status === 'DONE').length;

    return success(res, {
      turns: enrichedTurns,
      cycleNumber: activeCycle.cycleNumber,
      cycleStartDate: activeCycle.startDate,
      cycleDueDate: activeCycle.dueDate,
      receivedCount,
      totalMembers: turns.length,
      allReceived: turns.length > 0 && receivedCount === turns.length,
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
    const { turnNumber } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const activeCycle = await getActiveCycle(groupId);
    if (!activeCycle) {
      return error(res, 'Aucun cycle actif. Démarrez un cycle avant de marquer un tour reçu.', 400);
    }

    const turn = await prisma.turn.findUnique({
      where: { cycleId_turnNumber: { cycleId: activeCycle.id, turnNumber } },
      include: { user: true },
    });
    if (!turn) return error(res, 'Tour introuvable pour ce cycle', 404);

    const updated = await prisma.turn.update({
      where: { id: turn.id },
      data: { status: 'DONE' },
      include: { user: true },
    });

    // Notifier le membre (push + notification en base)
    await notifyTurnReceived({
      tenantId: req.tenant.id,
      group,
      user: updated.user,
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
      targetId: updated.id,
      metadata: { memberName: updated.user.name, turnNumber, cycleNumber: activeCycle.cycleNumber },
    });

    return success(res, updated,
      `${updated.user.name} a bien reçu sa mise — Tour N°${turnNumber} (Cycle N°${activeCycle.cycleNumber})`);
  } catch (err) {
    console.error('markTurnReceived error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  getContributions,
  markContributionReceived,
  markContributionLate,
  getMemberContributions,
  hideMemberContribution,
  getGroupTurns,
  markTurnReceived,
};