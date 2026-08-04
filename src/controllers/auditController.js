// src/controllers/auditController.js
const logger = require('../config/logger');
const prisma = require('../config/database');
const { success, error } = require('../utils/response');
const { getEffectivePlan } = require('../services/subscriptionService');
const { getPlanConfig } = require('../config/plans');

// Nombre d'entrées visibles pour les plans qui n'ont pas le journal complet
// (fullAuditLog: false) — un aperçu suffisant pour donner envie de passer
// au plan Pro, sans donner un accès complet gratuitement.
const AUDIT_PREVIEW_LIMIT = 15;

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

    const effectivePlan = await getEffectivePlan(req.tenant.id);
    const hasFullAuditLog = !!getPlanConfig(effectivePlan).limits.fullAuditLog;
    const requestedLimit = Math.min(parseInt(limit) || 100, 500);
    const effectiveLimit = hasFullAuditLog ? requestedLimit : Math.min(requestedLimit, AUDIT_PREVIEW_LIMIT);

    const totalCount = await prisma.auditLog.count({ where: { groupId, tenantId: req.tenant.id } });

    const logs = await prisma.auditLog.findMany({
      where: { groupId, tenantId: req.tenant.id },
      orderBy: { createdAt: 'desc' },
      take: effectiveLimit,
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

    return success(res, {
      logs: enriched,
      isTruncated: !hasFullAuditLog && totalCount > effectiveLimit,
      totalCount,
    });
  } catch (err) {
    logger.error('getGroupAuditLog error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { getGroupAuditLog };