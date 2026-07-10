// src/controllers/activityController.js
const prisma = require('../config/database');
const { success, error } = require('../utils/response');
const { formatActivity } = require('../utils/activityFormatter');

// ─── FIL D'ACTIVITÉS (vue simplifiée et supprimable) ──────────────────────
// Basé sur le Journal d'audit, mais filtre les entrées masquées et ne montre
// que les 30 plus récentes. Contrairement au Journal d'audit complet, une
// activité peut être retirée de cette liste sans jamais toucher à
// l'enregistrement d'audit sous-jacent (qui reste consultable en entier
// via /audit-log).
const getGroupActivity = async (req, res) => {
  try {
    const { groupId } = req.params;
    const tenantId = req.tenant.id;

    const group = await prisma.group.findFirst({ where: { id: groupId, tenantId } });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const logs = await prisma.auditLog.findMany({
      where: { groupId, tenantId, isDismissed: false },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const activities = logs.map((log) => {
      const { type, text } = formatActivity(log);
      return { id: log.id, type, text, date: log.createdAt };
    });

    return success(res, activities);
  } catch (err) {
    console.error('getGroupActivity error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MASQUER UNE ACTIVITÉ (suppression douce) ─────────────────────────────
// Retire l'entrée du fil "Activités" uniquement. L'entrée reste en base et
// continue d'apparaître intégralement dans le Journal d'audit.
const dismissActivity = async (req, res) => {
  try {
    const { groupId, id } = req.params;
    const tenantId = req.tenant.id;

    const log = await prisma.auditLog.findFirst({ where: { id, groupId, tenantId } });
    if (!log) return error(res, 'Activité introuvable', 404);

    await prisma.auditLog.update({
      where: { id },
      data: { isDismissed: true },
    });

    return success(res, null, 'Activité supprimée de la liste');
  } catch (err) {
    console.error('dismissActivity error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const getGerantDashboard = async (req, res) => {
  try {
    const tenantId = req.tenant.id;

    const groups = await prisma.group.findMany({
      where: { tenantId, isActive: true },
      include: {
        _count: { select: { groupMembers: true } },
        contributions: {
          where: { status: { in: ['PENDING', 'LATE'] } },
          include: { user: true },
          orderBy: { dueDate: 'asc' },
          take: 5,
        },
      },
    });

    const dashboard = {
      totalGroups: groups.length,
      alerts: [],
      upcomingDue: [],
    };

    for (const group of groups) {
      const late = group.contributions.filter(c => c.status === 'LATE');
      const pending = group.contributions.filter(c => c.status === 'PENDING');

      if (late.length > 0) {
        dashboard.alerts.push({
          type: 'LATE',
          groupId: group.id,
          groupName: group.name,
          count: late.length,
          message: `${late.length} cotisation(s) en retard`,
          members: late.map(c => c.user.name),
        });
      }

      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const dueSoon = pending.filter(c => new Date(c.dueDate) <= nextWeek);

      if (dueSoon.length > 0) {
        dashboard.upcomingDue.push({
          type: 'DUE_SOON',
          groupId: group.id,
          groupName: group.name,
          count: dueSoon.length,
          message: `${dueSoon.length} cotisation(s) dues cette semaine`,
          dueDate: dueSoon[0].dueDate,
        });
      }
    }

    return success(res, dashboard);
  } catch (err) {
    console.error('getGerantDashboard error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { getGroupActivity, dismissActivity, getGerantDashboard };