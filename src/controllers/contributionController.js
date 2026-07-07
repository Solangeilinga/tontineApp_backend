// src/controllers/contributionController.js
const prisma = require('../config/database');
const { success, error, created } = require('../utils/response');

// ─── CRÉER UN CYCLE DE COTISATIONS ────────────────────────────────────────
const createCycleContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { dueDate } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
    });

    if (members.length === 0) {
      return error(res, 'Aucun membre dans ce groupe', 400);
    }

    const contributions = await prisma.$transaction(
      members.map((m) =>
        prisma.contribution.create({
          data: {
            groupId,
            userId: m.userId,
            amount: group.amount,
            dueDate: new Date(dueDate),
            status: 'PENDING',
          },
        })
      )
    );

    return created(res, contributions,
      `${contributions.length} cotisations créées avec succès`);
  } catch (err) {
    console.error('createCycleContributions error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── LISTE DES COTISATIONS ─────────────────────────────────────────────────
const getContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { status } = req.query;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const where = { groupId };
    if (status) where.status = status;

    const contributions = await prisma.contribution.findMany({
      where,
      include: { user: true },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
    });

    return success(res, contributions);
  } catch (err) {
    console.error('getContributions error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER UNE COTISATION REÇUE ─────────────────────────────────────────
const markContributionReceived = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: { group: true },
    });

    if (!contribution) return error(res, 'Cotisation introuvable', 404);
    if (contribution.group.tenantId !== req.tenant.id) {
      return error(res, 'Non autorisé', 403);
    }

    const updated = await prisma.contribution.update({
      where: { id },
      data: {
        status: 'RECEIVED',
        paidDate: new Date(),
        note: note || null,
      },
      include: { user: true },
    });

    return success(res, updated, 'Cotisation marquée comme reçue');
  } catch (err) {
    console.error('markContributionReceived error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER UNE COTISATION EN RETARD ─────────────────────────────────────
const markContributionLate = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: { group: true },
    });

    if (!contribution) return error(res, 'Cotisation introuvable', 404);
    if (contribution.group.tenantId !== req.tenant.id) {
      return error(res, 'Non autorisé', 403);
    }

    const updated = await prisma.contribution.update({
      where: { id },
      data: {
        status: 'LATE',
        note: note || null,
      },
      include: { user: true },
    });

    return success(res, updated, 'Cotisation marquée en retard');
  } catch (err) {
    console.error('markContributionLate error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── COTISATIONS DU MEMBRE ─────────────────────────────────────────────────
const getMemberContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) return error(res, 'Vous n\'êtes pas membre de ce groupe', 403);

    const contributions = await prisma.contribution.findMany({
      where: { groupId, userId },
      orderBy: { dueDate: 'desc' },
    });

    return success(res, contributions);
  } catch (err) {
    console.error('getMemberContributions error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── LISTE DES TOURS ───────────────────────────────────────────────────────
const getGroupTurns = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const turns = await prisma.turn.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { turnNumber: 'asc' },
    });

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { orderTurn: 'asc' },
    });

    const receivedUserIds = turns
      .filter(t => t.status === 'DONE')
      .map(t => t.userId);

    const pendingMembers = members.filter(
      m => !receivedUserIds.includes(m.userId)
    );

    return success(res, {
      turns,
      pendingMembers,
      receivedCount: receivedUserIds.length,
      totalMembers: members.length,
    });
  } catch (err) {
    console.error('getGroupTurns error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER UN TOUR REÇU ─────────────────────────────────────────────────
const markTurnReceived = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId, turnNumber } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });
    if (!group) return error(res, 'Groupe introuvable', 404);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) return error(res, 'Membre introuvable dans ce groupe', 404);

    const turn = await prisma.turn.upsert({
      where: { groupId_turnNumber: { groupId, turnNumber } },
      update: { status: 'DONE', userId },
      create: {
        groupId,
        userId,
        turnNumber,
        scheduledDate: new Date(),
        status: 'DONE',
      },
      include: { user: true },
    });

    return success(res, turn,
      `${turn.user.name} a bien reçu sa mise — Tour N°${turnNumber}`);
  } catch (err) {
    console.error('markTurnReceived error:', err.message);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  createCycleContributions,
  getContributions,
  markContributionReceived,
  markContributionLate,
  getMemberContributions,
  getGroupTurns,
  markTurnReceived,
};