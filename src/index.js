// src/index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { generalLimiter } = require('./middleware/rateLimiter');
const { scheduleDailyReminders } = require('./services/notificationService');
const { scheduleSubscriptionChecks } = require('./services/subscriptionCron');
const { initFirebase } = require('./config/firebase');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const notificationRoutes = require('./routes/notifications');
const subscriptionRoutes = require('./routes/subscriptions');
const publicRoutes = require('./routes/public');

const app = express();

// ── Trust proxy
app.set('trust proxy', 1);

// ── CORS ─────────────────────────────────────────────────────────────────
// L'API n'utilise QUE des tokens Bearer (jamais de cookies de session), donc
// un `origin: '*'` ne permet PAS de voler un token (un site tiers ne peut
// pas lire le storage d'un autre onglet/app). Mais par défense en
// profondeur (et pour éviter qu'un futur usage de cookies ne devienne un
// vrai risque CSRF sans qu'on y pense), on restreint désormais aux
// origines explicitement autorisées — configurable via env pour ne pas
// coder en dur un domaine potentiellement erroné.
//
// CORS_ALLOWED_ORIGINS="https://matontine.app,https://www.matontine.app"
// Nécessaire notamment pour que le site vitrine (formulaire de demande de
// suppression de compte) puisse appeler POST /api/public/deletion-requests
// sans être bloqué par le navigateur — ajoute son domaine à la liste.
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Pas d'origine (apps mobiles natives, curl, Postman) → toujours OK,
    // c'est le cas d'usage principal de cette API (app Flutter).
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`⚠️  CORS refusé pour l'origine : ${origin}`);
    return callback(new Error('Non autorisé par CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// ── Body brut pour le webhook SebPay UNIQUEMENT — nécessaire pour vérifier
// la signature HMAC (voir subscriptionController.handleWebhook). Doit être
// monté AVANT express.json() global, sinon le body arrive déjà parsé.
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json', limit: '100kb' }));

app.use(express.json({ limit: '10kb' })); // Limite taille requête
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(generalLimiter);

// ── Routes
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/public', publicRoutes);

// ── Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    app: 'MaTontine API',
  });
});

// ── 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route introuvable' });
});

// ── Erreur globale
app.use((err, req, res, next) => {
  console.error('💥 Erreur non gérée:', err.message);
  res.status(500).json({ success: false, message: 'Erreur serveur interne' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 MaTontine API démarrée sur le port ${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);

  if (process.env.FIREBASE_PROJECT_ID) {
    initFirebase();
  }

  scheduleDailyReminders();
  scheduleSubscriptionChecks();

  // ── ⚠️ AUCUNE synchronisation de schéma ne doit avoir lieu ici. ─────────
  // Auparavant, ce bloc lançait `prisma db push --accept-data-loss` à
  // CHAQUE démarrage du serveur — commande qui accepte explicitement toute
  // perte de données nécessaire (colonnes supprimées, types changés) sans
  // revue humaine ni rollback possible. Un simple redémarrage/redeploy
  // pouvait donc altérer silencieusement les données de production.
  //
  // La bonne pratique : des migrations SQL versionnées et commitées
  // (`prisma/migrations/`), appliquées par une étape de déploiement
  // EXPLICITE et séparée du process applicatif — jamais au runtime.
  //
  //   1. En local : `npx prisma migrate dev --name <description>` crée et
  //      applique la migration, et l'ajoute à prisma/migrations/ (à commiter).
  //   2. En production : `npx prisma migrate deploy` (voir script "release"
  //      dans package.json) rejoue uniquement les migrations non encore
  //      appliquées, SANS jamais accepter de perte de données implicite —
  //      si une migration est destructive, elle doit être écrite/relue
  //      explicitement par un humain.
  //   3. Sur Render/Railway : configurer cette commande comme "Release
  //      Command" / "Pre-Deploy Command" dans le dashboard, pas dans le
  //      code applicatif (qui ignore de toute façon souvent "start" de
  //      package.json au profit d'une Start Command dédiée).
  if (process.env.NODE_ENV === 'production' && !process.env.CI) {
    console.log('ℹ️  Rappel : les migrations Prisma doivent être appliquées via `npm run release` (prisma migrate deploy) en étape de déploiement, pas au démarrage du serveur.');
  }
});

module.exports = app;