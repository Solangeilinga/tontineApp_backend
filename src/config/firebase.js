// src/config/firebase.js
const admin = require('firebase-admin');

let firebaseApp;

const getFirebaseApp = () => {
  if (!firebaseApp) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    console.log('✅ Firebase initialisé');
  }
  return firebaseApp;
};

module.exports = { getFirebaseApp };
