// src/routes/groups.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticateTenant, authenticateUser } = require('../middleware/auth');
const groupCtrl = require('../controllers/groupController');
const memberCtrl = require('../controllers/memberController');
const contribCtrl = require('../controllers/contributionController');

// ── Validation groupe
const groupValidators = [
  body('name').notEmpty().withMessage('Nom du groupe requis'),
  body('amount').isFloat({ min: 0 }).withMessage('Montant invalide'),
];

// ─── ROUTES GÉRANT ────────────────────────────────────────────────────────

// Groupes
router.post('/', authenticateTenant, groupValidators, validate, groupCtrl.createGroup);
router.get('/', authenticateTenant, groupCtrl.getGroups);
router.get('/:id', authenticateTenant, groupCtrl.getGroup);
router.put('/:id', authenticateTenant, validate, groupCtrl.updateGroup);
router.patch('/:id/archive', authenticateTenant, groupCtrl.archiveGroup);

// Récap cycle
router.get('/:groupId/recap', authenticateTenant, groupCtrl.getCycleRecap);

// Membres d'un groupe
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
router.delete('/:groupId/members/:userId', authenticateTenant, memberCtrl.removeMember);
router.put('/:groupId/members/turn-order',
  authenticateTenant,
  body('orders').isArray().withMessage('Format invalide'),
  validate,
  memberCtrl.updateTurnOrder
);

// Cotisations d'un groupe
router.get('/:groupId/contributions', authenticateTenant, contribCtrl.getContributions);
router.post('/:groupId/contributions/cycle',
  authenticateTenant,
  body('dueDate').isISO8601().withMessage('Date invalide'),
  validate,
  contribCtrl.createCycleContributions
);
router.patch('/contributions/:id/received', authenticateTenant, contribCtrl.markContributionReceived);
router.patch('/contributions/:id/late', authenticateTenant, contribCtrl.markContributionLate);

// ─── ROUTES MEMBRE ────────────────────────────────────────────────────────
router.get('/member/my-groups', authenticateUser, groupCtrl.getMemberGroups);
router.get('/:groupId/member/turns', authenticateUser, memberCtrl.getMemberTurns);
router.get('/:groupId/member/contributions', authenticateUser, contribCtrl.getMemberContributions);

module.exports = router;
