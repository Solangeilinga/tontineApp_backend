// src/config/logger.js
//
// Logger structuré (JSON en production, lisible en dev) — remplace les
// `console.log`/`console.error`/`console.warn` dispersés dans tout le
// projet. Un format JSON est exploitable par un outil d'observabilité
// (Datadog, Better Stack, etc.), contrairement à du texte libre.
//
// Usage : const logger = require('../config/logger');
//         logger.info('message'); logger.warn({ userId }, 'message');
//         logger.error({ err }, 'message');
const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  // pino-pretty est une devDependency : en production, on garde du JSON
  // brut (plus rapide, exploitable par les outils de logs), pas de mise
  // en forme couleur qui n'a de sens que dans un terminal local.
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
  redact: {
    // Ne jamais logger un token/OTP/PIN en clair, même par accident dans
    // un objet passé au logger (ex: `logger.info({ req: req.body }, ...)`)
    paths: [
      'req.headers.authorization',
      '*.password', '*.pin', '*.pinHash', '*.otp', '*.accessToken', '*.refreshToken',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
