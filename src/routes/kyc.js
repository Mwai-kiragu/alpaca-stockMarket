const express = require('express');
const { body, param } = require('express-validator');
const kycController = require('../controllers/kycController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Validation middleware
const validateDocumentUpload = [
  body('registrationId')
    .isUUID()
    .withMessage('Valid registration ID is required'),
  body('documentType')
    .optional()
    .isIn(['government_id', 'id_front', 'id_back', 'passport', 'drivers_license', 'proof_of_address', 'bank_statement', 'utility_bill'])
    .withMessage('Invalid document type')
];

const validateVerificationUpdate = [
  param('documentId')
    .isUUID()
    .withMessage('Valid document ID is required'),
  body('status')
    .isIn(['pending', 'approved', 'rejected', 'under_review'])
    .withMessage('Invalid verification status'),
  body('rejectionReason')
    .optional()
    .isString()
    .withMessage('Rejection reason must be a string')
];

// Routes
router.post('/registration/documents',
  kycController.uploadMiddleware,
  validateDocumentUpload,
  kycController.uploadDocuments
);

router.get('/registration/:registrationId/documents',
  param('registrationId').isUUID(),
  kycController.getDocuments
);

// Admin only routes (require authentication)
router.patch('/documents/:documentId/verification',
  auth,
  validateVerificationUpdate,
  kycController.updateVerificationStatus
);

module.exports = router;