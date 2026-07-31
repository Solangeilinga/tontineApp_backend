// src/index.js
require('dotenv').config();

// ── Synchroniser le schéma Prisma vers la base au démarrage ────────────────
// Pourquoi ici et pas juste dans package.json "scripts.start" : certaines
// plateformes (Render, etc.) permettent de configurer une "Start Command"
// dans leur tableau de bord qui ignore complètement le "start" de
// package.json. En le faisant ici, ça s'exécute quel que soit ce qui a
// lancé le process (node src/index.js, npm start, un Procfile...).
// Uniquement en production : en local, on garde le contrôle via
// `npm run db:migrate` pour ne pas surprendre un dev qui lance `npm run dev`.
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  try {
    console.log('🔄 Synchronisation du schéma Prisma avec la base...');
    const { execSync } = require('child_process');
    execSync('npx prisma db push --accept-data-loss', {
      stdio: 'inherit',
    });
    console.log('✅ Schéma Prisma synchronisé');
  } catch (err) {
    // On ne bloque PAS le démarrage : si la synchro échoue (ex: schéma déjà
    // à jour mais message d'avertissement, ou souci réseau ponctuel), l'API
    // doit quand même démarrer — les routes qui touchent une table absente
    // renverront une erreur 500 explicite plutôt que de tout arrêter.
    console.error('⚠️  Échec de la synchronisation Prisma (le serveur démarre quand même):', err.message);
  }
}

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

const app = express();

// ── Trust proxy
app.set('trust proxy', 1);

// ── CORS — restreindre en production
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://matontine.app'] // ton domaine
  : ['*'];

app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? allowedOrigins : '*',
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
});

module.exports = app;