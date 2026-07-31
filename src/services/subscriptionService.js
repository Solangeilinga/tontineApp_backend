// src/services/subscriptionService.js
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/database');
const { getPlanConfig, isPaidPlan, TRIAL_DAYS } = require('../config/plans');
const sebpay = require('./sebpayService');
const { logAction } = require('./auditService');
const { sendPushNotification } = require('./notificationService');

// ─── RÉCUPÉRER (OU CRÉER) L'ABONNEMENT D'UN TENANT ────────────────────────
// Tout tenant doit avoir une Subscription — créée paresseusement au premier
// accès si elle n'existe pas encore (ex: comptes créés avant ce module).
const getOrCreateSubscription = async (tenantId) => {
  let sub = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!sub) {
    sub = await prisma.subscription.create({
      data: { tenantId, plan: 'FREE', status: 'ACTIVE' },
    });
  }
  return sub;
};

// ─── L'ABONNEMENT EST-IL ACTUELLEMENT VALIDE ? ────────────────────────────
// FREE est toujours "valide" (c'est le palier de base, sans expiration).
// ACTIVE et CANCELED restent valides tant que currentPeriodEnd n'est pas
// dépassé — un gérant qui annule garde son accès jusqu'à la fin de la
// période déjà payée. Seul PAST_DUE (expiré sans annulation) est invalide.
const isSubscriptionValid = (sub) => {
  if (sub.plan === 'FREE') return true;
  if (sub.status === 'PAST_DUE') return false;
  if (!sub.currentPeriodEnd) return false;
  return new Date(sub.currentPeriodEnd) > new Date();
};

// ─── VÉRIFIER UNE LIMITE FONCTIONNELLE (paywall) ──────────────────────────
// Retourne { allowed: boolean, reason?: string }. Utilisé par le middleware
// requireActiveSubscription et par les contrôleurs (createGroup, addMember...).
const checkLimit = async (tenantId, limitKey, currentCount) => {
  const sub = await getOrCreateSubscription(tenantId);
  const effectivePlan = isSubscriptionValid(sub) ? sub.plan : 'FREE';
  const config = getPlanConfig(effectivePlan);
  const max = config.limits[limitKey];

  if (max === null || max === undefined) return { allowed: true };
  if (currentCount < max) return { allowed: true };

  return {
    allowed: false,
    reason: `Limite du plan ${config.label} atteinte (${max}). Passez à un forfait supérieur pour continuer.`,
  };
};

// ─── VÉRIFIER UNE FONCTIONNALITÉ BOOLÉENNE (export, journal complet...) ──
const checkFeature = async (tenantId, featureKey) => {
  const sub = await getOrCreateSubscription(tenantId);
  const effectivePlan = isSubscriptionValid(sub) ? sub.plan : 'FREE';
  const config = getPlanConfig(effectivePlan);
  const allowed = !!config.limits[featureKey];

  return {
    allowed,
    reason: allowed
      ? undefined
      : `Cette fonctionnalité nécessite le forfait Pro. Passez à un forfait supérieur pour y accéder.`,
  };
};

// ─── EFFECTIVE PLAN ACTUEL (utilitaire pour les vues type audit log) ─────
const getEffectivePlan = async (tenantId) => {
  const sub = await getOrCreateSubscription(tenantId);
  return isSubscriptionValid(sub) ? sub.plan : 'FREE';
};
// Crée un Payment PENDING et déclenche la collecte SebPay. Ne modifie PAS
// encore la Subscription — ça, c'est le rôle exclusif du webhook (source de
// vérité unique pour l'argent réellement reçu).
const initiateSubscriptionPayment = async ({ tenant, plan, phone, operator, country, otpCode }) => {
  if (!isPaidPlan(plan)) {
    return { success: false, message: 'Plan invalide pour un paiement' };
  }

  const planConfig = getPlanConfig(plan);
  const sub = await getOrCreateSubscription(tenant.id);
  const externalReference = `SUB-${tenant.id}-${Date.now()}-${uuidv4().slice(0, 8)}`;

  const payment = await prisma.payment.create({
    data: {
      subscriptionId: sub.id,
      tenantId: tenant.id,
      plan,
      amount: planConfig.amount,
      currency: planConfig.currency,
      operator,
      phone,
      country: country || 'BJ',
      externalReference,
      status: 'PENDING',
    },
  });

  const result = await sebpay.initiateCollection({
    amount: planConfig.amount,
    phone,
    operator,
    country: country || 'BJ',
    externalReference,
    otpCode,
  });

  if (!result.success) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REJECTED' },
    });
    return { success: false, message: result.message };
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { sebpayTransactionId: result.data?.transaction_id || null },
  });

  await logAction({
    tenantId: tenant.id,
    actorType: 'TENANT',
    actorId: tenant.id,
    actorName: tenant.name,
    action: 'SUBSCRIPTION_PAYMENT_INITIATED',
    targetType: 'Payment',
    targetId: payment.id,
    metadata: { plan, amount: planConfig.amount, externalReference },
  });

  return {
    success: true,
    message: result.message || 'Paiement initié. Validez la demande reçue sur votre téléphone.',
    data: { externalReference, transactionId: result.data?.transaction_id },
  };
};

// ─── TRAITER LE WEBHOOK SEBPAY (approved / rejected) ──────────────────────
// C'est le SEUL endroit qui active ou prolonge un abonnement. Idempotent :
// un webhook rejoué pour un Payment déjà APPROVED ne prolonge pas deux fois.
const handleWebhookPayload = async (payload) => {
  const { external_reference, status, transaction_id } = payload;

  const payment = await prisma.payment.findUnique({
    where: { externalReference: external_reference },
    include: { subscription: { include: { tenant: true } } },
  });

  if (!payment) {
    console.warn(`Webhook SebPay reçu pour une référence inconnue: ${external_reference}`);
    return { handled: false };
  }

  // Idempotence : si déjà traité en APPROVED, ne rien refaire.
  if (payment.status === 'APPROVED') {
    return { handled: true, alreadyProcessed: true };
  }

  const normalizedStatus = status === 'approved' ? 'APPROVED' : status === 'rejected' ? 'REJECTED' : 'PENDING';

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: normalizedStatus,
      sebpayTransactionId: transaction_id || payment.sebpayTransactionId,
      rawWebhookPayload: payload,
    },
  });

  if (normalizedStatus !== 'APPROVED') {
    return { handled: true, activated: false };
  }

  // ── Paiement confirmé : on active/prolonge l'abonnement.
  const planConfig = getPlanConfig(payment.plan);
  const sub = payment.subscription;
  const now = new Date();

  // Si l'abonnement en cours est encore valide, on prolonge à partir de sa
  // date de fin (pas de perte de jours en cas de renouvellement anticipé).
  const base = sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now
    ? new Date(sub.currentPeriodEnd)
    : now;
  const newPeriodEnd = new Date(base.getTime() + planConfig.durationDays * 24 * 60 * 60 * 1000);

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      plan: payment.plan,
      status: 'ACTIVE',
      currentPeriodEnd: newPeriodEnd,
      expiryReminderSentAt: null,
    },
  });

  await logAction({
    tenantId: payment.tenantId,
    actorType: 'TENANT',
    actorId: payment.tenantId,
    actorName: sub.tenant.name,
    action: 'SUBSCRIPTION_ACTIVATED',
    targetType: 'Subscription',
    targetId: sub.id,
    metadata: { plan: payment.plan, currentPeriodEnd: newPeriodEnd },
  });

  if (sub.tenant.fcmToken) {
    await sendPushNotification({
      token: sub.tenant.fcmToken,
      title: 'Abonnement activé ✅',
      body: `Votre plan ${planConfig.label} est actif jusqu'au ${newPeriodEnd.toLocaleDateString('fr-FR')}.`,
      data: { type: 'SUBSCRIPTION_ACTIVATED' },
    });
  }

  return { handled: true, activated: true };
};

// ─── ANNULER (OU DÉSANNULER) L'ABONNEMENT ─────────────────────────────────
// Par défaut : annulation "à la fin de la période" — le gérant garde son
// accès payant jusqu'à currentPeriodEnd, puis retombe silencieusement en
// FREE (pas de relance PAST_DUE puisqu'il a choisi de ne pas continuer).
// immediate=true : downgrade FREE tout de suite, sans remboursement (les
// paiements Mobile Money via SebPay ne sont pas remboursables depuis notre
// API — à gérer manuellement côté support si besoin).
const cancelSubscription = async ({ tenant, immediate = false }) => {
  const sub = await getOrCreateSubscription(tenant.id);

  if (sub.plan === 'FREE') {
    return { success: false, message: 'Aucun abonnement payant actif à annuler.' };
  }

  if (immediate) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        plan: 'FREE',
        status: 'ACTIVE',
        currentPeriodEnd: null,
        expiryReminderSentAt: null,
      },
    });

    await logAction({
      tenantId: tenant.id,
      actorType: 'TENANT',
      actorId: tenant.id,
      actorName: tenant.name,
      action: 'SUBSCRIPTION_CANCELED_IMMEDIATE',
      targetType: 'Subscription',
      targetId: sub.id,
    });

    return { success: true, message: 'Abonnement annulé immédiatement. Vous êtes repassé au plan Gratuit.' };
  }

  // ── Annulation différée : reste payant jusqu'à currentPeriodEnd.
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'CANCELED' },
  });

  await logAction({
    tenantId: tenant.id,
    actorType: 'TENANT',
    actorId: tenant.id,
    actorName: tenant.name,
    action: 'SUBSCRIPTION_CANCELED_AT_PERIOD_END',
    targetType: 'Subscription',
    targetId: sub.id,
    metadata: { currentPeriodEnd: sub.currentPeriodEnd },
  });

  return {
    success: true,
    message: sub.currentPeriodEnd
      ? `Abonnement annulé. Vous gardez l'accès ${getPlanConfig(sub.plan).label} jusqu'au ${new Date(sub.currentPeriodEnd).toLocaleDateString('fr-FR')}.`
      : 'Abonnement annulé.',
  };
};

// ─── RÉACTIVER UN ABONNEMENT ANNULÉ (avant qu'il n'expire) ────────────────
// Permet de revenir sur une annulation différée tant que la période payée
// n'est pas encore terminée — évite de payer une nouvelle collecte pour
// rien si le gérant change d'avis.
const reactivateSubscription = async (tenant) => {
  const sub = await getOrCreateSubscription(tenant.id);

  if (sub.status !== 'CANCELED') {
    return { success: false, message: 'Aucune annulation en attente pour cet abonnement.' };
  }
  if (!sub.currentPeriodEnd || new Date(sub.currentPeriodEnd) <= new Date()) {
    return { success: false, message: 'La période payée est déjà terminée. Souscrivez un nouveau paiement.' };
  }

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'ACTIVE' },
  });

  return { success: true, message: 'Abonnement réactivé.' };
};

// ─── EXPIRER LES ABONNEMENTS DÉPASSÉS (à appeler via cron quotidien) ──────
// Deux cas distincts :
//  - status ACTIVE et expiré  → PAST_DUE (le gérant n'a pas renouvelé à
//    temps, on continue de le relancer pour qu'il paie).
//  - status CANCELED et expiré → downgrade silencieux vers FREE (il avait
//    explicitement choisi de ne pas continuer, pas de relance de paiement).
const expirePastDueSubscriptions = async () => {
  const now = new Date();

  const expiredActive = await prisma.subscription.findMany({
    where: { status: 'ACTIVE', plan: { not: 'FREE' }, currentPeriodEnd: { lt: now } },
    include: { tenant: true },
  });

  for (const sub of expiredActive) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'PAST_DUE' },
    });

    if (sub.tenant.fcmToken) {
      await sendPushNotification({
        token: sub.tenant.fcmToken,
        title: 'Abonnement expiré',
        body: "Renouvelez votre abonnement pour garder l'accès complet à vos groupes.",
        data: { type: 'SUBSCRIPTION_EXPIRED' },
      });
    }
  }

  const expiredCanceled = await prisma.subscription.findMany({
    where: { status: 'CANCELED', plan: { not: 'FREE' }, currentPeriodEnd: { lt: now } },
    include: { tenant: true },
  });

  for (const sub of expiredCanceled) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null, expiryReminderSentAt: null },
    });
    // Pas de push ici : l'annulation était volontaire, le gérant sait déjà.
  }

  return { pastDueCount: expiredActive.length, silentlyDowngradedCount: expiredCanceled.length };
};

// ─── RAPPEL J-3 AVANT EXPIRATION (à appeler via cron quotidien) ───────────
// Ne concerne QUE les abonnements ACTIVE (pas CANCELED — ceux-là expirent
// silencieusement par choix du gérant, pas besoin de les relancer).
const sendExpiryReminders = async () => {
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const expiringSoon = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      plan: { not: 'FREE' },
      currentPeriodEnd: { gt: now, lte: in3Days },
      expiryReminderSentAt: null,
    },
    include: { tenant: true },
  });

  for (const sub of expiringSoon) {
    if (sub.tenant.fcmToken) {
      const planLabel = getPlanConfig(sub.plan).label;
      await sendPushNotification({
        token: sub.tenant.fcmToken,
        title: 'Votre abonnement expire bientôt',
        body: `Votre forfait ${planLabel} expire le ${new Date(sub.currentPeriodEnd).toLocaleDateString('fr-FR')}. Renouvelez pour ne pas perdre l'accès.`,
        data: { type: 'SUBSCRIPTION_EXPIRING' },
      });
    }
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { expiryReminderSentAt: now },
    });
  }

  return expiringSoon.length;
};

module.exports = {
  getOrCreateSubscription,
  isSubscriptionValid,
  checkLimit,
  checkFeature,
  getEffectivePlan,
  initiateSubscriptionPayment,
  handleWebhookPayload,
  cancelSubscription,
  reactivateSubscription,
  expirePastDueSubscriptions,
  sendExpiryReminders,
};
