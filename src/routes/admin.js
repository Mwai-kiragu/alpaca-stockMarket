const express = require('express');
const { auth, adminAuth } = require('../middleware/auth');
const {
  getPendingKYC,
  getKYCDetails,
  approveKYC,
  rejectKYC,
  requestKYCInfo,
  syncKYCFromAlpaca,
  bulkSyncKYCFromAlpaca
} = require('../controllers/adminController');

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(auth);
router.use(adminAuth);

// KYC Management Routes
router.get('/kyc/pending', getPendingKYC);
router.get('/kyc/:userId', getKYCDetails);
router.post('/kyc/:userId/approve', approveKYC);
router.post('/kyc/:userId/reject', rejectKYC);
router.post('/kyc/:userId/request-info', requestKYCInfo);

// Alpaca KYC Sync Routes
router.post('/kyc/:userId/sync-alpaca', syncKYCFromAlpaca);
router.post('/kyc/bulk-sync-alpaca', bulkSyncKYCFromAlpaca);

module.exports = router;