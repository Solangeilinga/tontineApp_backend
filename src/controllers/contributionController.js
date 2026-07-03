// src/controllers/contributionController.js
const prisma = require('../config/database');
const { success, error, created } = require('../utils/response');
const { createNotification } = require('../services/notificationService');

// ─── LISTER LES COTISATIONS D'UN GROUPE ───────────────────────────────────
const getContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { status } = req.query;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    const where = { groupId };
    if (status) where.status = status;

    const contributions = await prisma.contribution.findMany({
      where,
      include: { user: true },
      orderBy: { dueDate: 'asc' },
    });

    return success(res, contributions);
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER UNE COTISATION COMME REÇUE ───────────────────────────────────
const markContributionReceived = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: {
        group: true,
        user: true,
      },
    });

    if (!contribution) {
      return error(res, 'Cotisation introuvable', 404);
    }

    // Vérifier que le groupe appartient au gérant
    if (contribution.group.tenantId !== req.tenant.id) {
      return error(res, 'Accès non autorisé', 403);
    }

    const updated = await prisma.contribution.update({
      where: { id },
      data: {
        status: 'RECEIVED',
        paidDate: new Date(),
        note,
      },
    });

    // Notifier le membre
    if (contribution.user.fcmToken) {
      await createNotification({
        tenantId: contribution.group.tenantId,
        userId: contribution.userId,
        type: 'CONTRIBUTION_CONFIRMED',
        title: 'Cotisation confirmée',
        message: `Votre cotisation de ${contribution.amount} ${contribution.group.currency} pour "${contribution.group.name}" a été reçue.`,
        data: { groupId: contribution.groupId, contributionId: id },
        fcmToken: contribution.user.fcmToken,
      });
    }

    return success(res, updated, 'Cotisation marquée comme reçue');
  } catch (err) {
    console.error(err);
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
      include: { group: true, user: true },
    });

    if (!contribution) {
      return error(res, 'Cotisation introuvable', 404);
    }

    if (contribution.group.tenantId !== req.tenant.id) {
      return error(res, 'Accès non autorisé', 403);
    }

    const updated = await prisma.contribution.update({
      where: { id },
      data: { status: 'LATE', note },
    });

    return success(res, updated, 'Cotisation marquée en retard');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── CRÉER LES COTISATIONS D'UN CYCLE ─────────────────────────────────────
const createCycleContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { dueDate } = req.body;

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: req.tenant.id },
      include: { groupMembers: { include: { user: true } } },
    });

    if (!group) {
      return error(res, 'Groupe introuvable', 404);
    }

    const due = new Date(dueDate);

    // Créer une cotisation pour chaque membre
    const contributions = await prisma.$transaction(
      group.groupMembers.map((member) =>
        prisma.contribution.create({
          data: {
            groupId,
            userId: member.userId,
            amount: group.amount,
            dueDate: due,
            status: 'PENDING',
          },
        })
      )
    );

    return created(res, contributions, `${contributions.length} cotisations créées`);
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── VUE MEMBRE : Historique de ses cotisations ───────────────────────────
const getMemberContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    const contributions = await prisma.contribution.findMany({
      where: { groupId, userId },
      include: { group: true },
      orderBy: { dueDate: 'desc' },
    });

    return success(res, contributions);
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = {
  getContributions,
  markContributionReceived,
  markContributionLate,
  createCycleContributions,
  getMemberContributions,
};
