const { normalizePhone, isValidPhone } = require('../utils/phone');

describe('normalizePhone', () => {
  test('laisse un numéro déjà au format international inchangé', () => {
    expect(normalizePhone('+22670000001')).toBe('+22670000001');
  });

  test('convertit le format 00XXXX en +XXXX', () => {
    expect(normalizePhone('0022670000001')).toBe('+22670000001');
  });

  test('ajoute l\'indicatif par défaut à un numéro local à 8 chiffres', () => {
    expect(normalizePhone('70000001')).toBe('+22670000001');
  });

  test('respecte un indicatif par défaut différent', () => {
    expect(normalizePhone('70000001', '+225')).toBe('+22570000001');
  });

  test('retire les espaces et tirets avant normalisation', () => {
    expect(normalizePhone('70 00-00-01')).toBe('+22670000001');
  });

  test('retourne null pour une entrée vide', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  test('retourne tel quel un format non reconnu (ni +, ni 00, ni 8 chiffres)', () => {
    expect(normalizePhone('123')).toBe('123');
  });
});

describe('isValidPhone', () => {
  test('accepte un numéro E.164 valide', () => {
    expect(isValidPhone('+22670000001')).toBe(true);
  });

  test('rejette un numéro sans +', () => {
    expect(isValidPhone('22670000001')).toBe(false);
  });

  test('rejette un numéro trop court', () => {
    expect(isValidPhone('+2267')).toBe(false);
  });

  test('rejette un numéro commençant par 0 après le +', () => {
    expect(isValidPhone('+0670000001')).toBe(false);
  });

  test('rejette une chaîne vide ou non numérique', () => {
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone('+abc')).toBe(false);
  });
});
