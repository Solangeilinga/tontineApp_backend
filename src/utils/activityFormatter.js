// src/utils/activityFormatter.js
// Transforme une entrée du journal d'audit en item lisible pour le fil
// "Activités" (texte + type d'icône). Utilisé uniquement pour cet affichage
// simplifié — le Journal d'audit complet, lui, affiche les entrées brutes.

const formatActivity = (log) => {
  const meta = log.metadata || {};

  switch (log.action) {
    case 'MEMBER_ADDED':
      return { type: 'MEMBER_JOINED', text: `${meta.memberName || 'Un membre'} a rejoint le groupe` };
    case 'MEMBER_REMOVED':
      return { type: 'GENERAL', text: `${meta.memberName || 'Un membre'} a été retiré du groupe` };
    case 'MEMBER_UPDATED':
      return { type: 'GENERAL', text: 'Informations d\'un membre modifiées' };
    case 'TURN_ORDER_UPDATED':
      return { type: 'GENERAL', text: 'Ordre des tours modifié' };
    case 'CONTRIBUTION_MARKED_RECEIVED':
      return {
        type: 'CONTRIBUTION_RECEIVED',
        text: `${meta.memberName || ''} a payé sa cotisation (Tour N°${meta.roundNumber ?? '?'})`,
      };
    case 'CONTRIBUTION_MARKED_LATE':
      return {
        type: 'CONTRIBUTION_LATE',
        text: `${meta.memberName || ''} est en retard sur sa cotisation`,
      };
    case 'TURN_MARKED_RECEIVED':
      return {
        type: 'CONTRIBUTION_RECEIVED',
        text: `${meta.memberName || ''} a reçu sa mise — Tour N°${meta.turnNumber ?? '?'}`,
      };
    case 'TURN_RESCHEDULED':
      return {
        type: 'GENERAL',
        text: `Tour N°${meta.turnNumber ?? '?'} de ${meta.memberName || ''} reprogrammé`,
      };
    case 'CYCLE_STARTED':
      return { type: 'GENERAL', text: `Cycle N°${meta.cycleNumber ?? '?'} démarré` };
    case 'CYCLE_CLOSED':
      return { type: 'GENERAL', text: `Cycle N°${meta.cycleNumber ?? '?'} clôturé` };
    case 'GROUP_CREATED':
      return { type: 'GENERAL', text: 'Groupe créé' };
    case 'GROUP_UPDATED':
      return { type: 'GENERAL', text: 'Groupe modifié' };
    case 'GROUP_ARCHIVED':
      return { type: 'GENERAL', text: 'Groupe archivé' };
    case 'GROUP_UNARCHIVED':
      return { type: 'GENERAL', text: 'Groupe réactivé' };
    default:
      return { type: 'GENERAL', text: log.action };
  }
};

module.exports = { formatActivity };