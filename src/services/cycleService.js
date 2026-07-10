// src/services/cycleService.js
const prisma = require('../config/database');
const { computeTurnDate } = require('../utils/dateInterval');

// ─── RÉCUPÉRER LE CYCLE ACTIF (sans le créer) ─────────────────────────────
const getActiveCycle = async (groupId) => {
  return prisma.cycle.findFirst({
    where: { groupId, status: 'ACTIVE' },
    orderBy: { cycleNumber: 'desc' },
  });
};

// ─── DÉMARRER UN CYCLE COMPLET ─────────────────────────────────────────────
// Calcule tout le calendrier des tours à partir de startDate + fréquence du
// groupe, crée un Turn par membre (avec sa date programmée), puis génère
// pour CHAQUE tour une Contribution par membre (due à la date de ce tour).
const startFullCycle = async (groupId, startDate) => {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) throw new Error('Groupe introuvable');

  const existingActive = await getActiveCycle(groupId);
  if (existingActive) {
    throw new Error(
      `Un cycle est déjà actif (Cycle N°${existingActive.cycleNumber}). Clôturez-le avant d'en démarrer un nouveau.`
    );
  }

  const members = await prisma.groupMember.findMany({
    where: { groupId },
    orderBy: { orderTurn: 'asc' },
  });
  if (members.length === 0) {
    throw new Error('Aucun membre dans ce groupe');
  }

  const last = await prisma.cycle.findFirst({
    where: { groupId },
    orderBy: { cycleNumber: 'desc' },
  });
  const cycleNumber = (last?.cycleNumber || 0) + 1;

  // ── Calcul du calendrier complet
  const turnDates = members.map((m, index) =>
    computeTurnDate(startDate, index, group.frequencyValue, group.frequencyUnit)
  );
  const dueDate = turnDates[turnDates.length - 1];

  const cycle = await prisma.cycle.create({
    data: {
      groupId,
      cycleNumber,
      startDate: new Date(startDate),
      dueDate,
    },
  });

  // ── Un Turn par membre, avec sa date programmée
  await prisma.turn.createMany({
    data: members.map((m, index) => ({
      groupId,
      cycleId: cycle.id,
      userId: m.userId,
      turnNumber: index + 1,
      scheduledDate: turnDates[index],
      status: 'UPCOMING',
    })),
  });

  // ── Pour CHAQUE tour (date de collecte), une Contribution par membre
  const contributionsData = [];
  for (let round = 0; round < members.length; round++) {
    for (const m of members) {
      contributionsData.push({
        groupId,
        cycleId: cycle.id,
        userId: m.userId,
        roundNumber: round + 1,
        amount: group.amount,
        dueDate: turnDates[round],
        status: 'PENDING',
      });
    }
  }
  await prisma.contribution.createMany({ data: contributionsData });

  return { cycle, totalTurns: members.length, totalContributions: contributionsData.length };
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

module.exports = { getActiveCycle, startFullCycle, closeActiveCycle };