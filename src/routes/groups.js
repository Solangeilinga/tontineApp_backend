// src/routes/groups.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticateTenant, authenticateUser } = require('../middleware/auth');
const groupCtrl = require('../controllers/groupController');
const memberCtrl = require('../controllers/memberController');
const contribCtrl = require('../controllers/contributionController');
const activityCtrl = require('../controllers/activityController');
const cycleCtrl = require('../controllers/cycleController');
const auditCtrl = require('../controllers/auditController');

const groupValidators = [
  body('name').notEmpty().withMessage('Nom du groupe requis'),
  body('amount').isFloat({ min: 0 }).withMessage('Montant invalide'),
  body('frequencyValue').optional().isInt({ min: 1 }).withMessage('Fréquence invalide'),
  body('frequencyUnit').optional().isIn(['DAYS', 'WEEKS', 'MONTHS']).withMessage('Unité de fréquence invalide'),
];

// ─── ROUTES FIXES EN PREMIER (avant les routes avec :id) ──────────────────
router.get('/dashboard/summary', authenticateTenant, activityCtrl.getGerantDashboard);
router.get('/member/my-groups', authenticateUser, groupCtrl.getMemberGroups);

// Cotisations — routes fixes avant :groupId
router.patch('/contributions/:id/received', authenticateTenant, contribCtrl.markContributionReceived);
router.patch('/contributions/:id/late', authenticateTenant, contribCtrl.markContributionLate);

// ─── ROUTES GÉRANT avec :id ────────────────────────────────────────────────
router.post('/', authenticateTenant, groupValidators, validate, groupCtrl.createGroup);
router.get('/', authenticateTenant, groupCtrl.getGroups);
router.get('/:id', authenticateTenant, groupCtrl.getGroup);
router.put('/:id', authenticateTenant, validate, groupCtrl.updateGroup);
router.patch('/:id/archive', authenticateTenant, groupCtrl.archiveGroup);
router.patch('/:id/unarchive', authenticateTenant, groupCtrl.unarchiveGroup);

// ─── ROUTES avec :groupId ──────────────────────────────────────────────────
router.get('/:groupId/recap', authenticateTenant, groupCtrl.getCycleRecap);
router.get('/:groupId/activity', authenticateTenant, activityCtrl.getGroupActivity);

// Membres
router.get('/:groupId/members', authenticateTenant, memberCtrl.getMembers);
router.post('/:groupId/members',
  authenticateTenant,
  [
    body('name').notEmpty().withMessage('Nom requis'),
    body('phone').notEmpty().withMessage('Téléphone requis'),
  ],
  validate,
  memberCtrl.addMember
);
router.put('/:groupId/members/turn-order',
  authenticateTenant,
  body('orders').isArray().withMessage('Format invalide'),
  validate,
  memberCtrl.updateTurnOrder
);
router.put('/:groupId/members/:userId', authenticateTenant, memberCtrl.updateMember);
router.delete('/:groupId/members/:userId', authenticateTenant, memberCtrl.removeMember);

// Cotisations
router.get('/:groupId/contributions', authenticateTenant, contribCtrl.getContributions);

// Tours
router.get('/:groupId/turns', authenticateTenant, contribCtrl.getGroupTurns);
router.post('/:groupId/turns/received',
  authenticateTenant,
  [
    body('turnNumber').isInt({ min: 1 }).withMessage('turnNumber invalide'),
  ],
  validate,
  contribCtrl.markTurnReceived
);
router.patch('/:groupId/turns/:turnId/reschedule',
  authenticateTenant,
  body('scheduledDate').isISO8601().withMessage('Date invalide'),
  validate,
  cycleCtrl.rescheduleTurn
);

// Cycles (tours de rotation)
router.get('/:groupId/cycles', authenticateTenant, cycleCtrl.getCycleHistory);
router.post('/:groupId/cycles/start',
  authenticateTenant,
  body('startDate').isISO8601().withMessage('Date de début invalide'),
  validate,
  cycleCtrl.startCycle
);
router.post('/:groupId/cycles/close', authenticateTenant, cycleCtrl.closeCurrentCycle);

// Journal d'audit
router.get('/:groupId/audit-log', authenticateTenant, auditCtrl.getGroupAuditLog);

// ─── ROUTES MEMBRE ────────────────────────────────────────────────────────
router.get('/:groupId/member/turns', authenticateUser, memberCtrl.getMemberTurns);
router.get('/:groupId/member/contributions', authenticateUser, contribCtrl.getMemberContributions);

module.exports = router;