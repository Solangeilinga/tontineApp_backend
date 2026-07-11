// src/controllers/notificationController.js
const prisma = require('../config/database');
const { success, error } = require('../utils/response');

// ─── LISTE DES NOTIFICATIONS D'UN MEMBRE ──────────────────────────────────
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, isDeleted: false },
        orderBy: { sentAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.notification.count({ where: { userId, isDeleted: false } }),
    ]);

    return success(res, {
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── SUPPRIMER UNE NOTIFICATION (suppression douce) ───────────────────────
// La notification disparaît de la liste du membre mais reste en base.
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notif = await prisma.notification.findFirst({ where: { id, userId } });
    if (!notif) return error(res, 'Notification introuvable', 404);

    await prisma.notification.update({
      where: { id },
      data: { isDeleted: true },
    });

    return success(res, null, 'Notification supprimée');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── NOMBRE DE NOTIFICATIONS NON LUES ─────────────────────────────────────
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await prisma.notification.count({
      where: { userId, isRead: false, isDeleted: false },
    });
    return success(res, { count });
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER UNE NOTIFICATION COMME LUE ───────────────────────────────────
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notif = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notif) {
      return error(res, 'Notification introuvable', 404);
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return success(res, null, 'Notification marquée comme lue');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── MARQUER TOUTES COMME LUES ────────────────────────────────────────────
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return success(res, null, 'Toutes les notifications marquées comme lues');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

// ─── ENREGISTRER LE TOKEN FCM ──────────────────────────────────────────────
// ─── METTRE À JOUR LE TOKEN FCM (gérant OU membre) ────────────────────────
const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (req.accountType === 'tenant') {
      await prisma.tenant.update({
        where: { id: req.tenant.id },
        data: { fcmToken },
      });
    } else {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { fcmToken },
      });
    }

    return success(res, null, 'Token FCM mis à jour');
  } catch (err) {
    console.error(err);
    return error(res, 'Erreur serveur', 500);
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead, updateFcmToken, deleteNotification, getUnreadCount };