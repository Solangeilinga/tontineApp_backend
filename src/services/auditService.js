// src/services/auditService.js
const prisma = require('../config/database');

// ─── ENREGISTRER UNE ACTION DANS LE JOURNAL D'AUDIT ───────────────────────
// Ne doit JAMAIS faire échouer l'action métier qui l'appelle : une erreur
// d'écriture du journal est catchée et loguée, mais ne remonte pas.
const logAction = async ({
  tenantId,
  groupId = null,
  actorType,
  actorId,
  actorName,
  action,
  targetType = null,
  targetId = null,
  metadata = null,
}) => {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        groupId,
        actorType,
        actorId,
        actorName,
        action,
        targetType,
        targetId,
        metadata,
      },
    });
  } catch (err) {
    console.error('Erreur écriture journal d\'audit:', err.message);
  }
};

module.exports = { logAction };