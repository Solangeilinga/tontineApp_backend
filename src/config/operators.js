// src/config/operators.js
//
// Liste blanche des opérateurs Mobile Money acceptés pour payer un
// abonnement. Volontairement restreint au démarrage — Orange Money et Moov
// Money uniquement, quel que soit le pays. Pour ouvrir un nouvel opérateur
// (MTN, Coris Money, Wave...) plus tard, il suffit d'ajouter un mot-clé ici,
// rien d'autre à toucher dans le code.
//
// On matche par mot-clé plutôt que par slug exact car SebPay peut faire
// varier légèrement le slug d'un pays à l'autre (ex: "orange_ci",
// "orange_bf"...) — le mot-clé reste stable.
const ALLOWED_OPERATOR_KEYWORDS = ['orange', 'moov'];

/**
 * @param {{ slug?: string, code?: string, name?: string }} operator
 * Objet opérateur tel que renvoyé par GET /operators de SebPay.
 */
const isOperatorAllowed = (operator) => {
  if (!operator) return false;
  const haystack = `${operator.slug || ''} ${operator.code || ''} ${operator.name || ''}`.toLowerCase();
  return ALLOWED_OPERATOR_KEYWORDS.some((keyword) => haystack.includes(keyword));
};

/**
 * Vérifie un slug brut (tel qu'envoyé par le client dans le body de la
 * requête POST /subscribe) sans avoir l'objet opérateur complet sous la main.
 */
const isOperatorSlugAllowed = (slug) => {
  if (!slug) return false;
  const s = slug.toLowerCase();
  return ALLOWED_OPERATOR_KEYWORDS.some((keyword) => s.includes(keyword));
};

module.exports = { ALLOWED_OPERATOR_KEYWORDS, isOperatorAllowed, isOperatorSlugAllowed };