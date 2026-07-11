// src/routes/notifications.js
const express = require('express');
const router = express.Router();
const { authenticateUser, authenticateAny } = require('../middleware/auth');
const ctrl = require('../controllers/notificationController');

router.get('/', authenticateUser, ctrl.getNotifications);
router.get('/unread-count', authenticateUser, ctrl.getUnreadCount);
router.patch('/:id/read', authenticateUser, ctrl.markAsRead);
router.patch('/read-all', authenticateUser, ctrl.markAllAsRead);
router.put('/fcm-token', authenticateAny, ctrl.updateFcmToken);
router.delete('/:id', authenticateUser, ctrl.deleteNotification);

module.exports = router;