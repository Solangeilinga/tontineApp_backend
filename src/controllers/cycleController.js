// src/controllers/cycleController.js
const prisma = require('../config/database');
const { success, error } = require('../utils/response');
const { getActiveCycle, closeActiveCycle } = require('../services/cycleService');
const { logAction } = require('../services/auditService');

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
        endDate: c.endDate,
        totalMembers: c.contributions.length,
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
      `Cycle N°${closed.cycleNumber} clôturé. Un nouveau cycle démarrera au prochain tour.`);
  } catch (err) {
    console.error('closeCurrentCycle error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { getCycleHistory, closeCurrentCycle };