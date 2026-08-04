// Test du point d'entrée le plus critique du projet : la vérification de
// signature du webhook de paiement. Sans cette vérification (ou avec une
// implémentation buggée), n'importe qui pourrait POSTer un faux webhook
// "approved" et activer un abonnement payant gratuitement.

const crypto = require('crypto');

const SECRET = 'test_secret_key_1234567890';

describe('verifyWebhookSignature', () => {
  let verifyWebhookSignature;

  beforeAll(() => {
    process.env.SEBPAY_PUBLIC_KEY = 'pk_test_dummy';
    process.env.SEBPAY_SECRET_KEY = SECRET;
    // Réimporte le module APRÈS avoir positionné les env vars, car
    // SEBPAY_SECRET_KEY est lu au chargement du module (const en haut de
    // fichier), pas à l'appel de la fonction.
    jest.resetModules();
    ({ verifyWebhookSignature } = require('../services/sebpayService'));
  });

  const sign = (body) =>
    crypto.createHmac('sha256', SECRET).update(body).digest('hex');

  test('accepte une signature valide', () => {
    const body = JSON.stringify({ event: 'collection.approved', external_reference: 'sub_123' });
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  test('rejette une signature invalide (corps modifié après signature)', () => {
    const body = JSON.stringify({ event: 'collection.approved', external_reference: 'sub_123' });
    const signature = sign(body);
    const tamperedBody = JSON.stringify({ event: 'collection.approved', external_reference: 'sub_999' });
    expect(verifyWebhookSignature(tamperedBody, signature)).toBe(false);
  });

  test('rejette une signature complètement fausse', () => {
    const body = JSON.stringify({ event: 'collection.approved' });
    expect(verifyWebhookSignature(body, 'signature_forgee_au_hasard')).toBe(false);
  });

  test('rejette une signature absente', () => {
    const body = JSON.stringify({ event: 'collection.approved' });
    expect(verifyWebhookSignature(body, undefined)).toBe(false);
    expect(verifyWebhookSignature(body, '')).toBe(false);
    expect(verifyWebhookSignature(body, null)).toBe(false);
  });

  test('rejette si la clé secrète serveur est absente', () => {
    jest.resetModules();
    delete process.env.SEBPAY_SECRET_KEY;
    const { verifyWebhookSignature: verifyWithoutSecret } = require('../services/sebpayService');
    const body = JSON.stringify({ event: 'collection.approved' });
    expect(verifyWithoutSecret(body, sign(body))).toBe(false);
    process.env.SEBPAY_SECRET_KEY = SECRET; // restaure pour les autres tests
  });

  test('rejette deux signatures de longueurs différentes sans lever d\'exception (timingSafeEqual)', () => {
    const body = JSON.stringify({ event: 'collection.approved' });
    expect(() => verifyWebhookSignature(body, 'trop_courte')).not.toThrow();
    expect(verifyWebhookSignature(body, 'trop_courte')).toBe(false);
  });
});
