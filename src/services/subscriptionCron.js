// src/services/subscriptionCron.js
//
// Suit le même pattern que scheduleDailyReminders() dans notificationService.js
// (pas de dépendance externe type node-cron, juste un setTimeout/setInterval
// calé sur une heure fixe — cohérent avec le reste du projet).

const logger = require('../config/logger');
const { expirePastDueSubscriptions, sendExpiryReminders, sendUpgradeNudges } = require('./subscriptionService');

const RUN_HOUR = 3; // 3h du matin — après les rappels de contribution (8h),
                     // avant le pic d'usage matinal des gérants.

const runCheck = async () => {
  try {
    const { pastDueCount, silentlyDowngradedCount } = await expirePastDueSubscriptions();
    if (pastDueCount > 0) {
      logger.info(`⏱️  ${pastDueCount} abonnement(s) passé(s) en PAST_DUE`);
    }
    if (silentlyDowngradedCount > 0) {
      logger.info(`⏱️  ${silentlyDowngradedCount} abonnement(s) annulé(s) repassé(s) en FREE`);
    }

    const reminded = await sendExpiryReminders();
    if (reminded > 0) {
      logger.info(`⏱️  ${reminded} rappel(s) d'expiration J-3 envoyé(s)`);
    }

    const nudged = await sendUpgradeNudges();
    if (nudged > 0) {
      logger.info(`⏱️  ${nudged} relance(s) d'upgrade envoyée(s) aux comptes Gratuit`);
    }
  } catch (err) {
    logger.error('Erreur vérification abonnements:', err.message);
  }
};

const scheduleSubscriptionChecks = () => {
  const now = new Date();
  const next = new Date();
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delay = next.getTime() - now.getTime();

  setTimeout(() => {
    runCheck();
    setInterval(runCheck, 24 * 60 * 60 * 1000);
  }, delay);

  logger.info(`⏱️  Vérification des abonnements planifiée à ${RUN_HOUR}h00 (dans ${Math.round(delay / 60000)} min)`);
};

module.exports = { scheduleSubscriptionChecks, runCheck };