// src/config/plans.js
//
// Source de vérité unique pour la tarification et les limites de chaque
// plan. Toute modification de prix ou de quota se fait UNIQUEMENT ici —
// jamais en dur dans un contrôleur.

const PLANS = {
  FREE: {
    label: 'Gratuit',
    amount: 0,
    durationDays: null, // pas d'expiration
    limits: {
      maxGroups: 1,
      maxMembersPerGroup: 8,
      exportEnabled: false,
      fullAuditLog: false,
    },
  },
  STARTER: {
    label: 'Starter',
    amount: 499,
    currency: 'XOF',
    durationDays: 30,
    limits: {
      maxGroups: null, // illimité
      maxMembersPerGroup: 20,
      exportEnabled: false,
      fullAuditLog: false,
    },
  },
  PRO: {
    label: 'Pro',
    amount: 900,
    currency: 'XOF',
    durationDays: 30,
    limits: {
      maxGroups: null,
      maxMembersPerGroup: null, // illimité
      exportEnabled: true,
      fullAuditLog: true,
    },
  },
};

// Durée de l'essai gratuit accordé une seule fois par tenant, sur
// n'importe quel plan payant choisi en premier.
const TRIAL_DAYS = 7;

const isPaidPlan = (plan) => plan === 'STARTER' || plan === 'PRO';

const getPlanConfig = (plan) => {
  const config = PLANS[plan];
  if (!config) throw new Error(`Plan inconnu: ${plan}`);
  return config;
};

module.exports = { PLANS, TRIAL_DAYS, isPaidPlan, getPlanConfig };
