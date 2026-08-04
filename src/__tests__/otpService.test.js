// Test du flux OTP complet, avec un faux client Redis en mémoire (pas de
// vrai Redis nécessaire pour ces tests). Couvre notamment le compteur de
// tentatives ajouté pour empêcher le brute-force d'un code à 6 chiffres
// (voir PARTIE 2 de l'audit — correction appliquée dans otpService.js).

// ─── Faux client Redis in-memory ───────────────────────────────────────
function createFakeRedis() {
  const store = new Map();
  return {
    async setEx(key, _ttl, value) { store.set(key, value); },
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async del(key) { store.delete(key); },
    async incr(key) {
      const current = parseInt(store.get(key) || '0', 10) + 1;
      store.set(key, String(current));
      return current;
    },
    async expire() { /* no-op pour les tests : pas de vraie expiration TTL */ },
  };
}

jest.mock('../config/redis', () => ({
  getRedisClient: jest.fn(),
}));

// otpService envoie un SMS via Africa's Talking en dehors du mode
// développement — on force NODE_ENV=development pour rester sur le chemin
// "dev_otp" et ne jamais toucher au réseau dans les tests.
process.env.NODE_ENV = 'development';

const { getRedisClient } = require('../config/redis');
const { sendOTP, verifyOTP } = require('../services/otpService');

describe('Flux OTP', () => {
  let fakeRedis;

  beforeEach(() => {
    fakeRedis = createFakeRedis();
    getRedisClient.mockResolvedValue(fakeRedis);
  });

  test('un OTP envoyé est vérifiable avec le bon code', async () => {
    const { dev_otp } = await sendOTP('+22670000001');
    const result = await verifyOTP('+22670000001', dev_otp);
    expect(result.valid).toBe(true);
  });

  test('un mauvais code est rejeté', async () => {
    await sendOTP('+22670000002');
    const result = await verifyOTP('+22670000002', '000000');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/incorrect/i);
  });

  test('un code est à usage unique (ne peut pas être rejoué)', async () => {
    const { dev_otp } = await sendOTP('+22670000003');
    const first = await verifyOTP('+22670000003', dev_otp);
    const second = await verifyOTP('+22670000003', dev_otp);
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(false);
  });

  test('aucun OTP envoyé → toujours rejeté', async () => {
    const result = await verifyOTP('+22670000004', '123456');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expiré|inexistant/i);
  });

  test('bloque après 5 tentatives échouées sur le même numéro (anti brute-force)', async () => {
    const { dev_otp } = await sendOTP('+22670000005');

    for (let i = 0; i < 5; i++) {
      const attempt = await verifyOTP('+22670000005', '111111');
      expect(attempt.valid).toBe(false);
    }

    // Même le BON code doit maintenant être rejeté : la fenêtre de
    // tentatives est épuisée, il faut redemander un nouveau code.
    const finalAttempt = await verifyOTP('+22670000005', dev_otp);
    expect(finalAttempt.valid).toBe(false);
    expect(finalAttempt.reason).toMatch(/trop de tentatives/i);
  });

  test('un numéro n\'affecte pas le compteur de tentatives d\'un autre numéro', async () => {
    await sendOTP('+22670000006');
    const { dev_otp: otpOther } = await sendOTP('+22670000007');

    // 5 échecs sur le premier numéro
    for (let i = 0; i < 5; i++) {
      await verifyOTP('+22670000006', '000000');
    }

    // Le second numéro doit rester utilisable normalement
    const result = await verifyOTP('+22670000007', otpOther);
    expect(result.valid).toBe(true);
  });
});
