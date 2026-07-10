// src/utils/dateInterval.js

// ─── AJOUTER UN INTERVALLE À UNE DATE ─────────────────────────────────────
// unit: 'DAYS' | 'WEEKS' | 'MONTHS'
// Pour les mois, on utilise setMonth (gère correctement les longueurs de
// mois variables — ex: 31 janvier + 1 mois -> ne dépasse pas sur mars).
const addInterval = (date, value, unit) => {
  const d = new Date(date);

  switch (unit) {
    case 'DAYS':
      d.setDate(d.getDate() + value);
      break;
    case 'WEEKS':
      d.setDate(d.getDate() + value * 7);
      break;
    case 'MONTHS':
      d.setMonth(d.getMonth() + value);
      break;
    default:
      throw new Error(`Unité de fréquence inconnue : ${unit}`);
  }

  return d;
};

// ─── CALCULER LA DATE DU TOUR N (0-indexé) ────────────────────────────────
// Le membre à la position 0 (premier) reçoit le jour même du début du cycle.
// Le membre à la position 1 reçoit après 1 intervalle, etc.
const computeTurnDate = (startDate, index, frequencyValue, frequencyUnit) => {
  if (index === 0) return new Date(startDate);
  return addInterval(startDate, frequencyValue * index, frequencyUnit);
};

module.exports = { addInterval, computeTurnDate };