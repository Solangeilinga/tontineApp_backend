// src/controllers/auditController.js
const prisma = require('../config/database');
const { success, error } = require('../utils/response');

// ─── LIBELLÉS LISIBLES DES ACTIONS ────────────────────────────────────────
const ACTION_LABELS = {
  GROUP_CREATED: 'Groupe créé',
  GROUP_UPDATED: 'Groupe modifié',
  GROUP_ARCHIVED: 'Groupe archivé',
  GROUP_UNARCHIVED: 'Groupe réactivé',
  MEMBER_ADDED: 'Membre ajouté',
  MEMBER_UPDATED: 'Membre modifié',
  MEMBER_REMOVED: 'Membre retiré',
  TURN_ORDER_UPDATED: 'Ordre des tours modifié',
  CYCLE_STARTED: 'Cycle démarré',
  CONTRIBUTION_MARKED_RECEIVED: 'Cotisation marquée reçue',
  CONTRIBUTION_MARKED_LATE: 'Cotisation marquée en retard',
  TURN_MARKED_RECEIVED: 'Tour marqué comme reçu',
  TURN_RESCHEDULED: 'Date de tour modifiée',
  CYCLE_CLOSED: 'Cycle clôturé',
};

// ─── JOURNAL D'AUDIT D'UN GROUPE ───────────────────────────────────────────
const getGroupAuditLog = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { limit = 100 } = req.query;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const logs = await prisma.auditLog.findMany({
      where: { groupId, tenantId: req.tenant.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 100, 500),
    });

    const enriched = logs.map((l) => ({
      id: l.id,
      action: l.action,
      actionLabel: ACTION_LABELS[l.action] || l.action,
      actorType: l.actorType,
      actorName: l.actorName,
      targetType: l.targetType,
      metadata: l.metadata,
      createdAt: l.createdAt,
    }));

    return success(res, enriched);
  } catch (err) {
    console.error('getGroupAuditLog error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { getGroupAuditLog };