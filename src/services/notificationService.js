// src/services/notificationService.js
const admin = require('firebase-admin');
const { getFirebaseApp } = require('../config/firebase');
const prisma = require('../config/database');

/**
 * Envoie une notification push via FCM
 */
const sendPushNotification = async ({ fcmToken, title, body, data = {} }) => {
  try {
    getFirebaseApp(); // initialise si nécessaire

    const message = {
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      token: fcmToken,
    };

    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (err) {
    console.error('❌ Erreur FCM:', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Sauvegarde une notification en base et l'envoie si fcmToken disponible
 */
const createNotification = async ({
  tenantId,
  userId,
  type,
  title,
  message,
  data = {},
  fcmToken = null,
}) => {
  // Sauvegarder en base
  const notif = await prisma.notification.create({
    data: { tenantId, userId, type, title, message, data },
  });

  // Envoyer push si token disponible
  if (fcmToken) {
    await sendPushNotification({ fcmToken, title, body: message, data });
  }

  return notif;
};

/**
 * Envoie des rappels de cotisation (appelé par un cron job)
 * J-2 et J-1 avant la date de cotisation
 */
const sendContributionReminders = async () => {
  const now = new Date();

  for (const daysAhead of [2, 1]) {
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysAhead);
    const dateStr = targetDate.toISOString().split('T')[0];

    const contributions = await prisma.contribution.findMany({
      where: {
        status: 'PENDING',
        dueDate: {
          gte: new Date(`${dateStr}T00:00:00`),
          lte: new Date(`${dateStr}T23:59:59`),
        },
      },
      include: {
        user: true,
        group: true,
      },
    });

    for (const contrib of contributions) {
      const type = daysAhead === 2 ? 'REMINDER_J2' : 'REMINDER_J1';
      const title = `Rappel tontine — ${contrib.group.name}`;
      const message = `Votre cotisation de ${contrib.amount} ${contrib.group.currency} est due dans ${daysAhead} jour(s).`;

      await createNotification({
        tenantId: contrib.group.tenantId,
        userId: contrib.userId,
        type,
        title,
        message,
        data: { groupId: contrib.groupId, contributionId: contrib.id },
        fcmToken: contrib.user.fcmToken,
      });
    }

    console.log(`📢 Rappels J-${daysAhead} envoyés : ${contributions.length}`);
  }
};

module.exports = { sendPushNotification, createNotification, sendContributionReminders };
