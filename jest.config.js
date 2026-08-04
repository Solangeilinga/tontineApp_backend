// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.js'],
  // Les tests ne doivent jamais dépendre d'un vrai Redis/Postgres/SMS —
  // tout est mocké (voir src/__tests__/). Un test qui échoue faute de
  // service externe indisponible est un signe qu'un mock manque, pas qu'il
  // faut lancer Redis/Postgres localement.
  clearMocks: true,
  setupFiles: ['<rootDir>/jest.setup.js'],
  verbose: true,
};
