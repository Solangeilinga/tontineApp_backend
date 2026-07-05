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
      from: process.env.AT_SENDER_ID || 'TontineApp',
    });
    return { success: true };
  } catch (err) {
    console.error('❌ Erreur SMS:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── NOTIFICATION PUSH FCM ─────────────────────────────────────────────────
const sendPushNotification = async ({ fcmToken, title, body, data = {} }) => {
  try {
    const admin = require('firebase-admin');
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

// ─── CRÉER NOTIFICATION EN BASE ────────────────────────────────────────────
const createNotification = async ({
  tenantId,
  userId,
  type,
  title,
  message,
  data = {},
  fcmToken = null,
}) => {
  const notif = await prisma.notification.create({
    data: { tenantId, userId, type, title, message, data },
  });

  if (fcmToken) {
    await sendPushNotification({ fcmToken, title, body: message, data });
  }

  return notif;
};

// ─── RAPPELS SMS AUTOMATIQUES ─────────────────────────────────────────────
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
      include: {
        user: true,
        group: true,
      },
    });

    for (const contrib of contributions) {
      const dayLabel = daysAhead === 1 ? 'demain' : `dans ${daysAhead} jours`;
      const message = daysAhead === 1
        ? `⏰ TontineApp - DEMAIN : Votre cotisation de ${contrib.amount} ${contrib.group.currency} pour "${contrib.group.name}" est due demain. Pensez à payer !`
        : `📅 TontineApp - Rappel : Votre cotisation de ${contrib.amount} ${contrib.group.currency} pour "${contrib.group.name}" est due ${dayLabel}.`;

      // Envoi SMS
      await sendSMS(contrib.user.phone, message);

      // Notification en base
      const typeLabel = daysAhead <= 1 ? 'REMINDER_J1' : 'REMINDER_J2';
      try {
        await createNotification({
          tenantId: contrib.group.tenantId,
          userId: contrib.userId,
          type: typeLabel,
          title: `Rappel cotisation — ${contrib.group.name}`,
          message,
          data: { groupId: contrib.groupId, contributionId: contrib.id },
          fcmToken: contrib.user.fcmToken,
        });
      } catch (e) {
        console.error('Erreur notification:', e.message);
      }
    }

    if (contributions.length > 0) {
      console.log(`✅ Rappels J-${daysAhead} envoyés : ${contributions.length} membres`);
    }
  }
};

// ─── PLANIFIER LES RAPPELS QUOTIDIENS ─────────────────────────────────────
const scheduleDailyReminders = () => {
  const now = new Date();
  const next8am = new Date();
  next8am.setHours(8, 0, 0, 0);

  // Si 8h est déjà passé aujourd'hui, programmer pour demain
  if (now >= next8am) {
    next8am.setDate(next8am.getDate() + 1);
  }

  const msUntil8am = next8am - now;
  const hoursUntil = Math.round(msUntil8am / 1000 / 60 / 60);

  console.log(`⏰ Rappels SMS programmés dans ${hoursUntil}h (à 8h00 chaque jour)`);

  setTimeout(() => {
    sendContributionReminders();
    // Répéter toutes les 24h
    setInterval(sendContributionReminders, 24 * 60 * 60 * 1000);
  }, msUntil8am);
};

module.exports = {
  sendSMS,
  sendPushNotification,
  createNotification,
  sendContributionReminders,
  scheduleDailyReminders,
};
