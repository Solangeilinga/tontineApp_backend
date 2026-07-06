// src/services/notificationService.js
const prisma = require('../config/database');

// ─── ENVOI SMS ─────────────────────────────────────────────────────────────
const sendSMS = async (phone, message) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`📱 SMS → ${phone}: ${message}`);
    return { success: true };
  }
  try {
    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({
      apiKey: process.env.AT_API_KEY,
      username: process.env.AT_USERNAME,
    });
    await at.SMS.send({
      to: [phone],
      message,
      from: process.env.AT_SENDER_ID || 'MaTontine',
    });
    return { success: true };
  } catch (err) {
    console.error('❌ Erreur SMS:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── ENVOI PUSH FCM ────────────────────────────────────────────────────────
const sendPush = async ({ fcmToken, title, body, data = {} }) => {
  if (!fcmToken) return { success: false, reason: 'Pas de token FCM' };

  try {
    const { getFirebase } = require('../config/firebase');
    const admin = getFirebase();

    const message = {
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        notification: {
          channelId: 'matontine_channel',
          priority: 'high',
          sound: 'default',
        },
      },
      token: fcmToken,
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Push envoyé: ${title}`);
    return { success: true, messageId: response };
  } catch (err) {
    // Token invalide → supprimer
    if (err.code === 'messaging/registration-token-not-registered') {
      console.log(`🗑️ Token FCM invalide, suppression...`);
      await prisma.user.updateMany({
        where: { fcmToken },
        data: { fcmToken: null },
      });
    }
    console.error('❌ Erreur FCM:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── CRÉER NOTIFICATION EN BASE + PUSH ────────────────────────────────────
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
    await sendPush({ fcmToken, title, body: message, data });
  }

  return notif;
};

// ─── ENVOYER PUSH À UN UTILISATEUR ────────────────────────────────────────
const notifyUser = async ({ userId, tenantId, type, title, message, data = {} }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  await createNotification({
    tenantId,
    userId,
    type,
    title,
    message,
    data,
    fcmToken: user.fcmToken,
  });
};

// ─── ENVOYER PUSH À TOUS LES MEMBRES D'UN GROUPE ──────────────────────────
const notifyGroupMembers = async ({ groupId, type, title, message, data = {} }) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      groupMembers: { include: { user: true } },
    },
  });
  if (!group) return;

  for (const member of group.groupMembers) {
    try {
      await createNotification({
        tenantId: group.tenantId,
        userId: member.userId,
        type,
        title,
        message,
        data,
        fcmToken: member.user.fcmToken,
      });
    } catch (e) {
      console.error(`Erreur notif membre ${member.userId}:`, e.message);
    }
  }
};

// ─── RAPPELS SMS + PUSH AUTOMATIQUES ─────────────────────────────────────
const sendContributionReminders = async () => {
  console.log('⏰ Lancement des rappels de cotisation...');
  const now = new Date();

  for (const daysAhead of [7, 3, 1]) {
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysAhead);
    const dateStr = targetDate.toISOString().split('T')[0];

    const contributions = await prisma.contribution.findMany({
      where: {
        status: 'PENDING',
        dueDate: {
          gte: new Date(`${dateStr}T00:00:00.000Z`),
          lte: new Date(`${dateStr}T23:59:59.999Z`),
        },
      },
      include: { user: true, group: true },
    });

    for (const contrib of contributions) {
      const dayLabel = daysAhead === 1 ? 'demain' : `dans ${daysAhead} jours`;
      const smsMessage = daysAhead === 1
        ? `⏰ MaTontine - DEMAIN : Votre cotisation de ${contrib.amount} ${contrib.group.currency} pour "${contrib.group.name}" est due demain. Pensez à payer !`
        : `📅 MaTontine - Rappel : Votre cotisation de ${contrib.amount} ${contrib.group.currency} pour "${contrib.group.name}" est due ${dayLabel}.`;

      const pushTitle = daysAhead === 1
        ? `⏰ Cotisation due demain !`
        : `📅 Rappel cotisation J-${daysAhead}`;

      const pushBody = `${contrib.group.name} — ${contrib.amount} ${contrib.group.currency} ${dayLabel}`;

      // SMS
      await sendSMS(contrib.user.phone, smsMessage);

      // Push + notification en base
      const typeLabel = daysAhead <= 1 ? 'REMINDER_J1' : 'REMINDER_J2';
      try {
        await createNotification({
          tenantId: contrib.group.tenantId,
          userId: contrib.userId,
          type: typeLabel,
          title: pushTitle,
          message: pushBody,
          data: { groupId: contrib.groupId, contributionId: contrib.id },
          fcmToken: contrib.user.fcmToken,
        });
      } catch (e) {
        console.error('Erreur notification rappel:', e.message);
      }
    }

    if (contributions.length > 0) {
      console.log(`✅ Rappels J-${daysAhead} : ${contributions.length} membres notifiés`);
    }
  }
};

// ─── PLANIFIER LES RAPPELS QUOTIDIENS ─────────────────────────────────────
const scheduleDailyReminders = () => {
  const now = new Date();
  const next8am = new Date();
  next8am.setHours(8, 0, 0, 0);

  if (now >= next8am) next8am.setDate(next8am.getDate() + 1);

  const msUntil8am = next8am - now;
  const hoursUntil = Math.round(msUntil8am / 1000 / 60 / 60);

  console.log(`⏰ Rappels SMS+Push programmés dans ${hoursUntil}h (à 8h00 chaque jour)`);

  setTimeout(() => {
    sendContributionReminders();
    setInterval(sendContributionReminders, 24 * 60 * 60 * 1000);
  }, msUntil8am);
};

module.exports = {
  sendSMS,
  sendPush,
  createNotification,
  notifyUser,
  notifyGroupMembers,
  sendContributionReminders,
  scheduleDailyReminders,
};