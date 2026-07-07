// src/controllers/activityController.js
const prisma = require('../config/database');
const { success, error } = require('../utils/response');

const getGroupActivity = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: { id: groupId },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const contributions = await prisma.contribution.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { joinedAt: 'desc' },
      take: 5,
    });

    const activities = [];

    for (const c of contributions) {
      if (c.status === 'RECEIVED') {
        activities.push({
          id: `contrib-received-${c.id}`,
          type: 'CONTRIBUTION_RECEIVED',
          text: `${c.user.name} a payé sa cotisation`,
          date: c.updatedAt,
          userId: c.userId,
        });
      } else if (c.status === 'LATE') {
        activities.push({
          id: `contrib-late-${c.id}`,
          type: 'CONTRIBUTION_LATE',
          text: `${c.user.name} est en retard`,
          date: c.updatedAt,
          userId: c.userId,
        });
      } else {
        activities.push({
          id: `contrib-pending-${c.id}`,
          type: 'CONTRIBUTION_PENDING',
          text: `Cotisation en attente — ${c.user.name}`,
          date: c.createdAt,
          userId: c.userId,
        });
      }
    }

    for (const m of members) {
      activities.push({
        id: `member-joined-${m.id}`,
        type: 'MEMBER_JOINED',
        text: `${m.user.name} a rejoint le groupe`,
        date: m.joinedAt,
        userId: m.userId,
      });
    }

    activities.sort((a, b) => new Date(b.date) - new Date(a.date));

    return success(res, activities.slice(0, 10));
  } catch (err) {
    console.error('getGroupActivity error:', err.message);
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

module.exports = { getGroupActivity, getGerantDashboard };