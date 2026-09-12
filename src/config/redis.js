// src/config/redis.js
const logger = require('../config/logger');
const { createClient } = require('redis');

let redisClient;

const getRedisClient = async () => {
  if (!redisClient) {
    // `connectTimeout` : sans lui, un handshake TCP/TLS qui ne répond
    // jamais (réseau bloqué, instance Upstash injoignable) laisse
    // `connect()` — et donc toute commande Redis derrière, `setEx()` inclus
    // — pendante indéfiniment. Observé en prod : une requête OTP restait
    // bloquée 45s+ sans la moindre réponse ni log, car rien ne coupait
    // jamais cette attente.
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: { connectTimeout: 8000 },
      // Sans ça, une commande envoyée pendant une reconnexion en cours est
      // mise en file d'attente et n'échoue JAMAIS tant que la reconnexion
      // ne réussit pas — observé en prod : le client entrait dans une
      // boucle de reconnexion qui échouait en continu (toutes les ~400ms),
      // et `setEx()` restait pendante indéfiniment derrière, sans jamais
      // remonter d'erreur à l'appelant.
      disableOfflineQueue: true,
    });

    client.on('error', (err) => {
      // `logger.error('texte', err)` n'est PAS le format pino attendu —
      // pino traite le premier argument comme le message et ignore les
      // suivants s'il n'y a pas de placeholder printf, donc `err` (et sa
      // vraie raison d'échec) disparaissait complètement des logs.
      logger.error({ err }, '❌ Redis Client Error');
    });

    client.on('connect', () => {
      logger.info('✅ Redis connecté');
    });

    try {
      await client.connect();
      redisClient = client;
    } catch (err) {
      // Ne PAS garder un client à moitié initialisé en cache : le prochain
      // appel doit retenter une connexion fraîche, pas hériter d'un état
      // cassé pour toujours (c'est cette absence de reset qui, combinée à
      // l'absence de `connectTimeout`, transformait un premier échec en
      // panne permanente jusqu'au redémarrage du service).
      await client.disconnect().catch(() => {});
      throw err;
    }
  }
  return redisClient;
};

module.exports = { getRedisClient };
