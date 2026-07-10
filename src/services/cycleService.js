// src/services/cycleService.js
const prisma = require('../config/database');

// ─── RÉCUPÉRER LE CYCLE ACTIF (sans le créer) ─────────────────────────────
const getActiveCycle = async (groupId) => {
  return prisma.cycle.findFirst({
    where: { groupId, status: 'ACTIVE' },
    orderBy: { cycleNumber: 'desc' },
  });
};

// ─── RÉCUPÉRER OU CRÉER LE CYCLE ACTIF ────────────────────────────────────
// Utilisé par les actions d'écriture (création de cotisations, marquage
// de tour reçu) : si aucun cycle actif n'existe pour ce groupe, on en
// démarre un nouveau automatiquement (cycle N°1 s'il s'agit du premier).
const getOrCreateActiveCycle = async (groupId) => {
  const existing = await getActiveCycle(groupId);
  if (existing) return existing;

  const last = await prisma.cycle.findFirst({
    where: { groupId },
    orderBy: { cycleNumber: 'desc' },
  });

  return prisma.cycle.create({
    data: {
      groupId,
      cycleNumber: (last?.cycleNumber || 0) + 1,
    },
  });
};

// ─── CLÔTURER LE CYCLE ACTIF ───────────────────────────────────────────────
const closeActiveCycle = async (groupId) => {
  const cycle = await getActiveCycle(groupId);
  if (!cycle) return null;

  return prisma.cycle.update({
    where: { id: cycle.id },
    data: { status: 'COMPLETED', endDate: new Date() },
  });
};

module.exports = { getActiveCycle, getOrCreateActiveCycle, closeActiveCycle };