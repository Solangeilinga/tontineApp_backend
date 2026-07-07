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
app.use(express.json({ limit: '10kb' })); // Limite taille requête
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(generalLimiter);

// ── Routes
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/notifications', notificationRoutes);

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
});

module.exports = app;