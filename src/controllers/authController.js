// src/controllers/authController.js
//
// Ce fichier faisait auparavant 1087+ lignes et mélangeait l'auth du
// gérant, celle du membre, la gestion du PIN et le refresh token — trop de
// responsabilités dans un seul fichier (voir audit, Partie 1 - Architecture).
//
// Le code a été redécoupé en 4 fichiers par domaine :
//   - tenantAuthController.js  : inscription / connexion / profil GÉRANT
//   - memberAuthController.js  : inscription / connexion / profil MEMBRE
//   - pinController.js         : PIN (gérant ET membre)
//   - tokenController.js       : refresh token
//
// Ce fichier ne fait plus que RÉ-EXPORTER l'ensemble sous les mêmes noms
// qu'avant — volontairement, pour que `routes/auth.js` (et tout autre code
// qui importerait `authController`) continue de fonctionner SANS AUCUNE
// modification. Si tu pars de zéro, importe plutôt directement depuis les
// fichiers spécifiques ci-dessus plutôt que depuis ce fichier de compatibilité.
module.exports = {
  ...require('./tenantAuthController'),
  ...require('./memberAuthController'),
  ...require('./pinController'),
  ...require('./tokenController'),
};
