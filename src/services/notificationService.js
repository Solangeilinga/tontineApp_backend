// src/services/notificationService.js
const admin = require('../config/firebase');
const prisma = require('../config/database');
const { logAction } = require('./auditService');

// ─── ENVOYER SMS via Africa's Talking ─────────────────────────────────────
const sendSMS = async (phone, message) => {
  try {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[SMS SANDBOX] To: ${phone} | Message: ${message}`);
      return;
    }

    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({
      apiKey: process.env.AT_API_KEY,
      username: process.env.AT_USERNAME,
    });

    const sms = at.SMS;
    const smsPayload = { to: [phone], message };
    // N'ajoute "from" que si un Sender ID est explicitement configuré et
    // approuvé — sinon Africa's Talking utilise son expéditeur générique.
    if (process.env.AT_SENDER_ID) smsPayload.from = process.env.AT_SENDER_ID;

    const response = await sms.send(smsPayload);

    const recipient = response?.SMSMessageData?.Recipients?.[0];
    console.log('📋 Réponse Africa\'s Talking:', JSON.stringify(response?.SMSMessageData || response));

    if (!recipient || recipient.status !== 'Success') {
      const reason = response?.SMSMessageData?.Message || recipient?.status || 'réponse invalide';
      console.error(`❌ Livraison SMS échouée à ${phone} — ${reason}${recipient?.statusCode ? ` (code ${recipient.statusCode})` : ''}`);
      return;
    }

    console.log(`SMS envoye a ${phone} — coût: ${recipient.cost}`);
  } catch (err) {
    console.error('Erreur envoi SMS:', err.message);
  }
};

// ─── ENVOYER NOTIFICATION PUSH ────────────────────────────────────────────
const sendPushNotification = async ({ token, title, body, data = {} }) => {
  try {
    if (!admin || !token) return;

    await admin.messaging().send({
      token,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: { channelId: 'matontine_channel' },
      },
    });

    console.log('Push envoye');
  } catch (err) {
    console.error('Erreur push:', err.message);
  }
};

// ─── CRÉER NOTIFICATION EN BASE ───────────────────────────────────────────
const createNotification = async ({
  tenantId,
  userId,
  type,
  title,
  message,
  data = {},
}) => {
  try {
    await prisma.notification.create({
      data: {
        tenantId,
        userId,
        type,
        title,
        message,
        data,
      },
    });
  } catch (err) {
    console.error('Erreur creation notification:', err.message);
  }
};

// ─── RAPPELS QUOTIDIENS ───────────────────────────────────────────────────
const scheduleDailyReminders = () => {
  // Exécuter tous les jours à 8h00
  const now = new Date();
  const next8AM = new Date();
  next8AM.setHours(8, 0, 0, 0);

  if (now > next8AM) {
    next8AM.setDate(next8AM.getDate() + 1);
  }

  const msUntil8AM = next8AM - now;

  setTimeout(() => {
    sendDailyReminders();
    // Répéter toutes les 24h
    setInterval(sendDailyReminders, 24 * 60 * 60 * 1000);
  }, msUntil8AM);

  console.log(`Rappels planifies dans ${Math.round(msUntil8AM / 1000 / 60)} minutes`);
};

const sendDailyReminders = async () => {
  try {
    console.log('Envoi des rappels quotidiens...');

    const today = new Date();
    const remindDays = [1, 3, 7]; // J-1, J-3, J-7

    for (const daysAhead of remindDays) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysAhead);
      targetDate.setHours(0, 0, 0, 0);

      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const contributions = await prisma.contribution.findMany({
        where: {
          status: 'PENDING',
          dueDate: {
            gte: targetDate,
            lt: nextDay,
          },
        },
        include: {
          user: true,
          group: true,
        },
      });

      for (const contrib of contributions) {
        const { user, group } = contrib;

        // Message sans emojis (push + in-app uniquement — pas de SMS)
        const reminderMessage = daysAhead === 1
          ? `MaTontine - Rappel : Votre cotisation de ${contrib.amount} ${group.currency} pour le groupe "${group.name}" est due demain. Merci de vous acquitter dans les delais.`
          : `MaTontine - Rappel : Votre cotisation de ${contrib.amount} ${group.currency} pour le groupe "${group.name}" est due dans ${daysAhead} jours.`;

        // Envoyer push si token disponible
        if (user.fcmToken) {
          await sendPushNotification({
            token: user.fcmToken,
            title: 'Rappel de cotisation',
            body: daysAhead === 1
              ? `Votre cotisation pour "${group.name}" est due demain.`
              : `Votre cotisation pour "${group.name}" est due dans ${daysAhead} jours.`,
            data: {
              groupId: group.id,
              type: 'REMINDER',
            },
          });
        }

        // Sauvegarder en base
        await createNotification({
          tenantId: group.tenantId,
          userId: user.id,
          type: daysAhead === 1 ? 'REMINDER_J1' : 'REMINDER_J2',
          title: 'Rappel de cotisation',
          message: reminderMessage,
          data: { groupId: group.id, contributionId: contrib.id },
        });
      }

      if (contributions.length > 0) {
        console.log(`${contributions.length} rappels envoyes pour J-${daysAhead}`);
      }
    }

    // ── COTISATIONS EN RETARD (dueDate dépassée, toujours PENDING) ─────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const overdueContributions = await prisma.contribution.findMany({
      where: { status: 'PENDING', dueDate: { lt: todayStart } },
      include: { user: true, group: true },
    });

    for (const contrib of overdueContributions) {
      const { user, group } = contrib;

      await prisma.contribution.update({
        where: { id: contrib.id },
        data: { status: 'LATE' },
      });

      const tenant = await prisma.tenant.findUnique({ where: { id: group.tenantId } });

      await notifyContributionOverdue({
        tenantId: group.tenantId,
        group,
        user,
        gerant: tenant,
        roundNumber: contrib.roundNumber,
        dueDate: contrib.dueDate,
      });
    }
    if (overdueContributions.length > 0) {
      console.log(`${overdueContributions.length} cotisation(s) marquée(s) en retard`);
    }

    // ── TOURS EN RETARD (scheduledDate dépassée, toujours UPCOMING) ─────────
    // N'envoie le rappel qu'UNE SEULE FOIS par tour (overdueReminderSentAt),
    // pour éviter un SMS quotidien tant que le gérant n'a pas régularisé.
    const overdueTurns = await prisma.turn.findMany({
      where: {
        status: 'UPCOMING',
        scheduledDate: { lt: todayStart },
        overdueReminderSentAt: null,
      },
      include: { user: true, group: true },
    });

    for (const turn of overdueTurns) {
      const { user, group } = turn;
      const tenant = await prisma.tenant.findUnique({ where: { id: group.tenantId } });

      await notifyTurnOverdue({
        tenantId: group.tenantId,
        group,
        user,
        gerant: tenant,
        turnNumber: turn.turnNumber,
        scheduledDate: turn.scheduledDate,
      });

      await prisma.turn.update({
        where: { id: turn.id },
        data: { overdueReminderSentAt: new Date() },
      });
    }
    if (overdueTurns.length > 0) {
      console.log(`${overdueTurns.length} rappel(s) de tour en retard envoyé(s) (une seule fois)`);
    }
  } catch (err) {
    console.error('Erreur rappels quotidiens:', err.message);
  }
};

// ─── NOTIFIER RETARD DE COTISATION (push + in-app uniquement) ─────────────
const notifyContributionOverdue = async ({ tenantId, group, user, gerant, roundNumber, dueDate }) => {
  try {
    const dateStr = new Date(dueDate).toLocaleDateString('fr-FR');

    const memberMessage =
      `Vous etes en retard sur votre cotisation de ${group.amount} ${group.currency} `
      + `pour le groupe "${group.name}" (echeance du ${dateStr}). Merci de regulariser rapidement.`;

    if (user.fcmToken) {
      await sendPushNotification({
        token: user.fcmToken,
        title: 'Cotisation en retard',
        body: `Votre cotisation pour "${group.name}" est en retard.`,
        data: { groupId: group.id, type: 'CONTRIBUTION_OVERDUE' },
      });
    }

    await createNotification({
      tenantId,
      userId: user.id,
      type: 'CONTRIBUTION_OVERDUE',
      title: 'Cotisation en retard',
      message: memberMessage,
      data: { groupId: group.id, roundNumber },
    });

    // ── Visibilité gérant : push + journal d'audit (historique permanent)
    if (gerant?.fcmToken) {
      await sendPushNotification({
        token: gerant.fcmToken,
        title: 'Cotisation en retard',
        body: `${user.name} est en retard sur sa cotisation du groupe "${group.name}".`,
        data: { groupId: group.id, type: 'CONTRIBUTION_OVERDUE' },
      });
    }

    await logAction({
      tenantId,
      groupId: group.id,
      actorType: 'USER',
      actorId: user.id,
      actorName: user.name,
      action: 'CONTRIBUTION_MARKED_LATE',
      targetType: 'Contribution',
      metadata: { memberName: user.name, roundNumber, dueDate, auto: true },
    });
  } catch (err) {
    console.error('Erreur notification retard cotisation:', err.message);
  }
};

// ─── NOTIFIER RETARD DE TOUR (push + in-app uniquement) ───────────────────
const notifyTurnOverdue = async ({ tenantId, group, user, gerant, turnNumber, scheduledDate }) => {
  try {
    const dateStr = new Date(scheduledDate).toLocaleDateString('fr-FR');

    const memberMessage =
      `Votre tour (N°${turnNumber}) dans le groupe "${group.name}" etait prevu `
      + `le ${dateStr}. Rapprochez-vous du gerant si vous n'avez pas encore recu votre mise.`;

    if (user.fcmToken) {
      await sendPushNotification({
        token: user.fcmToken,
        title: 'Tour en retard',
        body: memberMessage,
        data: { groupId: group.id, type: 'TURN_OVERDUE' },
      });
    }

    await createNotification({
      tenantId,
      userId: user.id,
      type: 'TURN_OVERDUE',
      title: 'Tour en retard',
      message: memberMessage,
      data: { groupId: group.id, turnNumber },
    });

    // ── Visibilité gérant : push + journal d'audit (historique permanent)
    if (gerant?.fcmToken) {
      await sendPushNotification({
        token: gerant.fcmToken,
        title: 'Tour en retard',
        body: `Le tour N°${turnNumber} de ${user.name} (groupe "${group.name}") n'a pas encore été confirmé.`,
        data: { groupId: group.id, type: 'TURN_OVERDUE' },
      });
    }

    await logAction({
      tenantId,
      groupId: group.id,
      actorType: 'USER',
      actorId: user.id,
      actorName: user.name,
      action: 'TURN_OVERDUE_DETECTED',
      targetType: 'Turn',
      metadata: { memberName: user.name, turnNumber, scheduledDate, auto: true },
    });
  } catch (err) {
    console.error('Erreur notification retard tour:', err.message);
  }
};

// ─── NOTIFIER NOUVEAU MEMBRE (in-app uniquement) ──────────────────────────
const notifyMemberJoined = async ({ tenantId, group, user }) => {
  try {
    const welcomeMessage =
      `Bienvenue dans la tontine "${group.name}" sur MaTontine ! `
      + `Montant de cotisation : ${group.amount} ${group.currency}. `
      + `Frequence : ${group.description || 'Voir avec le gerant'}.`;

    await createNotification({
      tenantId,
      userId: user.id,
      type: 'MEMBER_JOINED',
      title: `Bienvenue dans ${group.name}`,
      message: welcomeMessage,
      data: { groupId: group.id },
    });
  } catch (err) {
    console.error('Erreur notification nouveau membre:', err.message);
  }
};

// ─── NOTIFIER TOUR RECU ───────────────────────────────────────────────────
const notifyTurnReceived = async ({ tenantId, group, user, turnNumber }) => {
  try {
    const message =
      `MaTontine - Felicitations ! Vous avez recu votre mise du groupe "${group.name}" `
      + `(Tour N°${turnNumber}). Montant : ${group.amount} ${group.currency}.`;

    if (user.fcmToken) {
      await sendPushNotification({
        token: user.fcmToken,
        title: 'Vous avez recu votre mise !',
        body: `Tour N°${turnNumber} du groupe "${group.name}" confirme.`,
        data: { groupId: group.id, type: 'TURN_RECEIVED' },
      });
    }

    await createNotification({
      tenantId,
      userId: user.id,
      type: 'YOUR_TURN',
      title: 'Vous avez recu votre mise',
      message,
      data: { groupId: group.id, turnNumber },
    });
  } catch (err) {
    console.error('Erreur notification tour recu:', err.message);
  }
};

module.exports = {
  sendSMS,
  sendPushNotification,
  createNotification,
  scheduleDailyReminders,
  notifyMemberJoined,
  notifyTurnReceived,
  notifyContributionOverdue,
  notifyTurnOverdue,
};