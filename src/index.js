// src/index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { generalLimiter } = require('./middleware/rateLimiter');
const { scheduleDailyReminders } = require('./services/notificationService');
const { initFirebase } = require('./config/firebase');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const notificationRoutes = require('./routes/notifications');

const app = express();

// ── Trust proxy (obligatoire sur Render)
app.set('trust proxy', 1);

// ── Sécurité & parsing
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// ── Routes
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/notifications', notificationRoutes);

// ── Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    app: 'TontineApp API',
    env: process.env.NODE_ENV || 'development',
  });
});

// ── 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route introuvable' });
});

// ── Erreur globale
app.use((err, req, res, next) => {
  console.error('💥 Erreur non gérée:', err);
  res.status(500).json({ success: false, message: 'Erreur serveur interne' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 TontineApp API démarrée sur le port ${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);

  // ── Initialiser Firebase (si variables configurées)
  if (process.env.FIREBASE_PROJECT_ID) {
    initFirebase();
  } else {
    console.log('⚠️  Firebase non configuré — push notifications désactivées');
  }

  // ── Rappels SMS quotidiens
  scheduleDailyReminders();
});

module.exports = app;