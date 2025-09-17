const express = require('express');
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  createPriceAlert,
  getPriceAlerts,
  updatePriceAlert,
  deletePriceAlert,
  getNotificationSettings,
  updateNotificationSettings
} = require('../controllers/notificationController');
const { auth } = require('../middleware/auth');
const { paginationValidation } = require('../middleware/validation');

const router = express.Router();

router.get('/', auth, paginationValidation, getNotifications);
router.put('/:notificationId/read', auth, markAsRead);
router.put('/mark-all-read', auth, markAllAsRead);
router.delete('/:notificationId', auth, deleteNotification);

// Price Alerts
router.post('/alerts/price', auth, createPriceAlert);
router.get('/alerts/price', auth, getPriceAlerts);
router.put('/alerts/price/:alertId', auth, updatePriceAlert);
router.delete('/alerts/price/:alertId', auth, deletePriceAlert);

// Notification Settings
router.get('/settings', auth, getNotificationSettings);
router.put('/settings', auth, updateNotificationSettings);

module.exports = router;