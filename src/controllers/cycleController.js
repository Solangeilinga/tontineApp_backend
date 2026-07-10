// src/controllers/cycleController.js
const prisma = require('../config/database');
const { success, error } = require('../utils/response');
const { getActiveCycle, startFullCycle, closeActiveCycle } = require('../services/cycleService');
const { logAction } = require('../services/auditService');

// ─── DÉMARRER UN NOUVEAU CYCLE ──────────────────────────────────────────────
// Génère automatiquement tout le calendrier des tours (un par membre) et
// les cotisations correspondantes à chaque date de tour.
const startCycle = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { startDate } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const { cycle, totalTurns, totalContributions } = await startFullCycle(groupId, startDate);

    await logAction({
      tenantId: req.tenant.id,
      groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'CYCLE_STARTED',
      targetType: 'Cycle',
      targetId: cycle.id,
      metadata: {
        cycleNumber: cycle.cycleNumber,
        startDate: cycle.startDate,
        dueDate: cycle.dueDate,
        totalTurns,
        totalContributions,
      },
    });

    return success(res, cycle,
      `Cycle N°${cycle.cycleNumber} démarré — ${totalTurns} tour(s) programmé(s), échéance finale le ${new Date(cycle.dueDate).toLocaleDateString('fr-FR')}`);
  } catch (err) {
    console.error('startCycle error:', err.message);
    return error(res, err.message || 'Erreur serveur', err.message?.includes('déjà actif') ? 409 : 500);
  }
};

// ─── HISTORIQUE DES CYCLES ─────────────────────────────────────────────────
const getCycleHistory = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const cycles = await prisma.cycle.findMany({
      where: { groupId },
      orderBy: { cycleNumber: 'desc' },
      include: {
        contributions: true,
        turns: { include: { user: true }, orderBy: { turnNumber: 'asc' } },
      },
    });

    const enriched = cycles.map((c) => {
      const received = c.contributions.filter((x) => x.status === 'RECEIVED');
      const totalCollected = received.length * group.amount;
      const recipients = c.turns
        .filter((t) => t.status === 'DONE')
        .map((t) => ({ name: t.user.name, turnNumber: t.turnNumber }));

      return {
        id: c.id,
        cycleNumber: c.cycleNumber,
        status: c.status,
        startDate: c.startDate,
        dueDate: c.dueDate,
        endDate: c.endDate,
        totalMembers: c.turns.length,
        totalCollected,
        completionRate: c.contributions.length > 0
          ? Math.round((received.length / c.contributions.length) * 100)
          : 0,
        recipients,
      };
    });

    return success(res, enriched);
  } catch (err) {
    console.error('getCycleHistory error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── CLÔTURER LE CYCLE ACTIF ───────────────────────────────────────────────
const closeCurrentCycle = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const active = await getActiveCycle(groupId);
    if (!active) return error(res, 'Aucun cycle actif à clôturer', 400);

    const closed = await closeActiveCycle(groupId);

    await logAction({
      tenantId: req.tenant.id,
      groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'CYCLE_CLOSED',
      targetType: 'Cycle',
      targetId: closed.id,
      metadata: { cycleNumber: closed.cycleNumber },
    });

    return success(res, closed,
      `Cycle N°${closed.cycleNumber} clôturé. Vous pouvez démarrer un nouveau cycle.`);
  } catch (err) {
    console.error('closeCurrentCycle error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── REPROGRAMMER LA DATE D'UN TOUR ────────────────────────────────────────
// Modifie la date programmée d'un tour, et répercute ce changement sur les
// cotisations du même tour (même round) pour que leur date d'échéance reste
// cohérente. Si c'est le dernier tour, la date d'échéance du cycle est aussi
// mise à jour.
const rescheduleTurn = async (req, res) => {
  try {
    const { groupId, turnId } = req.params;
    const { scheduledDate } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const turn = await prisma.turn.findFirst({
      where: { id: turnId, groupId },
      include: { user: true, cycle: true },
    });
    if (!turn) return error(res, 'Tour introuvable', 404);

    const newDate = new Date(scheduledDate);

    const updatedTurn = await prisma.turn.update({
      where: { id: turnId },
      data: { scheduledDate: newDate },
      include: { user: true },
    });

    // ── Répercuter sur les cotisations du même round
    await prisma.contribution.updateMany({
      where: { cycleId: turn.cycleId, roundNumber: turn.turnNumber },
      data: { dueDate: newDate },
    });

    // ── Si c'est le dernier tour, mettre à jour l'échéance du cycle
    const totalTurns = await prisma.turn.count({ where: { cycleId: turn.cycleId } });
    if (turn.turnNumber === totalTurns) {
      await prisma.cycle.update({
        where: { id: turn.cycleId },
        data: { dueDate: newDate },
      });
    }

    await logAction({
      tenantId: req.tenant.id,
      groupId,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'TURN_RESCHEDULED',
      targetType: 'Turn',
      targetId: turnId,
      metadata: {
        memberName: turn.user.name,
        turnNumber: turn.turnNumber,
        oldDate: turn.scheduledDate,
        newDate,
      },
    });

    return success(res, updatedTurn, 'Date du tour mise à jour');
  } catch (err) {
    console.error('rescheduleTurn error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { startCycle, getCycleHistory, closeCurrentCycle, rescheduleTurn };