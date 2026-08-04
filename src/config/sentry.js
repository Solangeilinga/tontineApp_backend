// src/config/sentry.js
//
// Capture automatique des erreurs backend en production. Aucun compte
// Sentry n'est requis pour développer ou faire tourner les tests : sans
// SENTRY_DSN dans l'environnement, `init()` ne fait rien (les erreurs
// continuent d'être visibles via les logs Pino comme avant).
//
// Pour l'activer : créer un projet sur sentry.io (plateforme "Express"),
// puis ajouter dans .env :
//   SENTRY_DSN=https://xxxxx@oXXXXXX.ingest.sentry.io/XXXXXX
const Sentry = require('@sentry/node');
const logger = require('./logger');

const isEnabled = Boolean(process.env.SENTRY_DSN);

const init = () => {
  if (!isEnabled) {
    logger.info('Sentry désactivé (SENTRY_DSN absent) — voir src/config/sentry.js pour l\'activer.');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Trace ~10% des requêtes pour le monitoring de perf, sans envoyer une
    // trace complète sur CHAQUE requête (coût/volume) — ajustable via env
    // si tu veux plus de visibilité au début (ex: 1.0 = 100%).
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),

    // ── Confidentialité : par défaut, le SDK Sentry envoie le corps des
    // requêtes/réponses HTTP ET des infos d'identité (IP, etc.). Sur une
    // app financière où les payloads contiennent des numéros de téléphone,
    // OTP, PIN (hashé mais quand même), on restreint volontairement :
    //   - httpBodies: [] → n'envoie JAMAIS le corps des requêtes/réponses.
    //     Le stack trace + message d'erreur suffisent à débugger ; le
    //     numéro de téléphone d'un utilisateur n'a rien à faire sur Sentry.
    //   - userInfo: false → ne remonte pas automatiquement l'IP/l'identité
    //     de qui a déclenché l'erreur (le tenantId/userId reste visible si
    //     on l'attache nous-même via Sentry.setUser(), voir plus bas).
    // Voir https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
  });

  logger.info('Sentry activé (env: %s)', process.env.NODE_ENV || 'development');
};

module.exports = { init, isEnabled, Sentry };
