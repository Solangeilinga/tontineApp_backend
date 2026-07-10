// src/controllers/groupController.js
const prisma = require('../config/database');
const { success, error, created } = require('../utils/response');
const { getActiveCycle } = require('../services/cycleService');
const { logAction } = require('../services/auditService');

// ── Générer un code d'invitation unique garanti
const generateUniqueInviteCode = async () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let exists = true;

  while (exists) {
    code = Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');

    const existing = await prisma.group.findUnique({
      where: { inviteCode: code },
    });
    exists = !!existing;
  }

  return code;
};

const createGroup = async (req, res) => {
  try {
    const { name, type, frequency, amount, currency, description, maxMembers } = req.body;
    const tenantId = req.tenant.id;
    const inviteCode = await generateUniqueInviteCode();

    const group = await prisma.group.create({
      data: {
        tenantId,
        name,
        type: type || 'MONEY',
        frequency: frequency || 'OTHER',
        amount: parseFloat(amount),
        currency: currency || 'XOF',
        description,
        inviteCode,
        maxMembers: maxMembers ? parseInt(maxMembers) : null,
      },
    });

    await logAction({
      tenantId,
      groupId: group.id,
      actorType: 'TENANT',
      actorId: tenantId,
      actorName: req.tenant.name,
      action: 'GROUP_CREATED',
      targetType: 'Group',
      targetId: group.id,
      metadata: { name: group.name, amount: group.amount, currency: group.currency },
    });

    return created(res, group, 'Groupe créé avec succès');
  } catch (err) {
    console.error('createGroup error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const getGroups = async (req, res) => {
  try {
    const groups = await prisma.group.findMany({
      where: { tenantId: req.tenant.id },
      include: { _count: { select: { groupMembers: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = groups.map(g => ({
      ...g,
      isFull: g.maxMembers !== null && g._count.groupMembers >= g.maxMembers,
    }));

    return success(res, enriched);
  } catch (err) {
    console.error('getGroups error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

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
        _count: { select: { groupMembers: true } },
      },
    });

    if (!group) return error(res, 'Groupe introuvable', 404);

    return success(res, {
      ...group,
      isFull: group.maxMembers !== null && group._count.groupMembers >= group.maxMembers,
    });
  } catch (err) {
    console.error('getGroup error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, frequency, amount, currency, description, maxMembers } = req.body;

    const group = await prisma.group.findFirst({
      where: { id, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const updated = await prisma.group.update({
      where: { id },
      data: {
        name,
        frequency,
        amount: amount ? parseFloat(amount) : undefined,
        currency,
        description,
        maxMembers: maxMembers !== undefined
          ? (maxMembers === null ? null : parseInt(maxMembers))
          : undefined,
      },
    });

    await logAction({
      tenantId: req.tenant.id,
      groupId: id,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'GROUP_UPDATED',
      targetType: 'Group',
      targetId: id,
      metadata: { name, frequency, amount, currency, maxMembers },
    });

    return success(res, updated, 'Groupe mis à jour');
  } catch (err) {
    console.error('updateGroup error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const archiveGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await prisma.group.findFirst({
      where: { id, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    await prisma.group.update({ where: { id }, data: { isActive: false } });

    await logAction({
      tenantId: req.tenant.id,
      groupId: id,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'GROUP_ARCHIVED',
      targetType: 'Group',
      targetId: id,
    });

    return success(res, null, 'Groupe archivé');
  } catch (err) {
    console.error('archiveGroup error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const unarchiveGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await prisma.group.findFirst({
      where: { id, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    await prisma.group.update({ where: { id }, data: { isActive: true } });

    await logAction({
      tenantId: req.tenant.id,
      groupId: id,
      actorType: 'TENANT',
      actorId: req.tenant.id,
      actorName: req.tenant.name,
      action: 'GROUP_UNARCHIVED',
      targetType: 'Group',
      targetId: id,
    });

    return success(res, null, 'Groupe réactivé');
  } catch (err) {
    console.error('unarchiveGroup error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const getMemberGroups = async (req, res) => {
  try {
    const userId = req.user.id;

    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: { include: { _count: { select: { groupMembers: true } } } },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const groups = memberships.map((m) => ({
      ...m.group,
      orderTurn: m.orderTurn,
      joinedAt: m.joinedAt,
      isFull: m.group.maxMembers !== null &&
        m.group._count.groupMembers >= m.group.maxMembers,
    }));

    return success(res, groups);
  } catch (err) {
    console.error('getMemberGroups error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

const getCycleRecap = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const activeCycle = await getActiveCycle(groupId);

    if (!activeCycle) {
      return success(res, {
        group: {
          id: group.id,
          name: group.name,
          amount: group.amount,
          currency: group.currency,
        },
        cycleNumber: null,
        recap: null,
        contributions: [],
      });
    }

    const contributions = await prisma.contribution.findMany({
      where: { cycleId: activeCycle.id },
      include: { user: true },
      orderBy: { dueDate: 'desc' },
    });

    const totalExpected = contributions.length * group.amount;
    const received = contributions.filter(c => c.status === 'RECEIVED');
    const pending = contributions.filter(c => c.status === 'PENDING');
    const late = contributions.filter(c => c.status === 'LATE');
    const totalReceived = received.length * group.amount;

    return success(res, {
      group: {
        id: group.id,
        name: group.name,
        amount: group.amount,
        currency: group.currency,
      },
      cycleNumber: activeCycle.cycleNumber,
      recap: {
        totalMembers: contributions.length,
        totalExpected,
        totalReceived,
        remaining: totalExpected - totalReceived,
        receivedCount: received.length,
        pendingCount: pending.length,
        lateCount: late.length,
        completionRate: contributions.length > 0
          ? Math.round((received.length / contributions.length) * 100)
          : 0,
      },
      contributions,
    });
  } catch (err) {
    console.error('getCycleRecap error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  createGroup,
  getGroups,
  getGroup,
  updateGroup,
  archiveGroup,
  unarchiveGroup,
  getMemberGroups,
  getCycleRecap,
};