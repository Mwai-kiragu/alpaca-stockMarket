const express = require('express');
const { auth, adminAuth } = require('../middleware/auth');
const {
  getPendingKYC,
  getKYCDetails,
  approveKYC,
  rejectKYC,
  requestKYCInfo,
  syncKYCFromAlpaca,
  bulkSyncKYCFromAlpaca,
  getAnalytics,
  listUsers,
  getUserProfile,
  suspendUser,
  activateUser,
  deleteUser,
  updateUserRole,
  resetUserPassword,
  listOrders,
  cancelOrder,
  flagOrder,
  resolveOrder,
  getConfig,
  updateConfig,
  getRevenue,
} = require('../controllers/adminController');

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(auth);
router.use(adminAuth);

// Analytics
router.get('/analytics', getAnalytics);

// User Management Routes
router.get('/users', listUsers);
router.get('/users/:userId', getUserProfile);
router.put('/users/:userId/suspend', suspendUser);
router.put('/users/:userId/activate', activateUser);
router.put('/users/:userId/delete', deleteUser);
router.put('/users/:userId/role', updateUserRole);
router.post('/users/:userId/reset-password', resetUserPassword);

// Orders Management Routes
router.get('/orders', listOrders);
router.put('/orders/:orderId/cancel', cancelOrder);
router.put('/orders/:orderId/flag', flagOrder);
router.put('/orders/:orderId/resolve', resolveOrder);

// KYC Management Routes
router.get('/kyc/pending', getPendingKYC);
router.get('/kyc/:userId', getKYCDetails);
router.post('/kyc/:userId/approve', approveKYC);
router.post('/kyc/:userId/reject', rejectKYC);
router.post('/kyc/:userId/request-info', requestKYCInfo);

// Alpaca KYC Sync Routes
router.post('/kyc/:userId/sync-alpaca', syncKYCFromAlpaca);
router.post('/kyc/bulk-sync-alpaca', bulkSyncKYCFromAlpaca);

// Platform Config
router.get('/config', getConfig);
router.put('/config', updateConfig);

// Revenue
router.get('/revenue', getRevenue);

module.exports = router;