// src/config/firebase.js
const logger = require('../config/logger');
const admin = require('firebase-admin');

let initialized = false;

const initFirebase = () => {
  if (initialized) return;

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    initialized = true;
    logger.info('✅ Firebase initialisé');
  } catch (err) {
    logger.error('❌ Erreur Firebase:', err.message);
  }
};

const getFirebase = () => {
  if (!initialized) initFirebase();
  return admin;
};

module.exports = { initFirebase, getFirebase };