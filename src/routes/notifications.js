// src/routes/notifications.js
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const ctrl = require('../controllers/notificationController');

router.get('/', authenticateUser, ctrl.getNotifications);
router.patch('/:id/read', authenticateUser, ctrl.markAsRead);
router.patch('/read-all', authenticateUser, ctrl.markAllAsRead);
router.put('/fcm-token', authenticateUser, ctrl.updateFcmToken);
router.delete('/:id', authenticateUser, ctrl.deleteNotification);

module.exports = router;