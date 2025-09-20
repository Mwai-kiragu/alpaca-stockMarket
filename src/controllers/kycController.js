const KYCDocument = require('../models/KYCDocument');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { validationResult } = require('express-validator');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/kyc');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `kyc-${uniqueSuffix}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 2 // Maximum 2 files per request
  }
});

const kycController = {
  // Upload middleware
  uploadMiddleware: upload.fields([
    { name: 'document', maxCount: 1 },
    { name: 'id_front', maxCount: 1 },
    { name: 'id_back', maxCount: 1 }
  ]),

  // Upload KYC documents
  uploadDocuments: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { registrationId, documentType } = req.body;
      const files = req.files;

      // Verify registration exists
      const user = await User.findByPk(registrationId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Registration not found'
        });
      }

      if (!files || Object.keys(files).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded'
        });
      }

      const uploadedDocs = [];

      // Handle single document upload
      if (files.document && files.document[0]) {
        const file = files.document[0];
        const docType = documentType || 'government_id';

        const kycDoc = await KYCDocument.create({
          registrationId,
          documentType: docType,
          fileName: file.filename,
          originalFileName: file.originalname,
          filePath: file.path,
          fileSize: file.size,
          mimeType: file.mimetype,
          metadata: {
            uploadedAt: new Date(),
            uploadIP: req.ip
          }
        });

        uploadedDocs.push({
          id: kycDoc.id,
          documentType: docType,
          fileName: file.originalname
        });
      }

      // Handle front and back ID uploads
      if (files.id_front && files.id_front[0]) {
        const frontFile = files.id_front[0];
        const frontDocType = req.body.frontDocumentType || 'id_front';

        const frontDoc = await KYCDocument.create({
          registrationId,
          documentType: frontDocType,
          fileName: frontFile.filename,
          originalFileName: frontFile.originalname,
          filePath: frontFile.path,
          fileSize: frontFile.size,
          mimeType: frontFile.mimetype,
          metadata: {
            uploadedAt: new Date(),
            uploadIP: req.ip,
            side: 'front'
          }
        });

        uploadedDocs.push({
          id: frontDoc.id,
          documentType: frontDocType,
          fileName: frontFile.originalname,
          side: 'front'
        });
      }

      if (files.id_back && files.id_back[0]) {
        const backFile = files.id_back[0];
        const backDocType = req.body.backDocumentType || 'id_back';

        const backDoc = await KYCDocument.create({
          registrationId,
          documentType: backDocType,
          fileName: backFile.filename,
          originalFileName: backFile.originalname,
          filePath: backFile.path,
          fileSize: backFile.size,
          mimeType: backFile.mimetype,
          metadata: {
            uploadedAt: new Date(),
            uploadIP: req.ip,
            side: 'back'
          }
        });

        uploadedDocs.push({
          id: backDoc.id,
          documentType: backDocType,
          fileName: backFile.originalname,
          side: 'back'
        });
      }

      // Update user registration status
      await user.update({
        registrationStatus: 'documents_uploaded'
      });

      res.status(201).json({
        success: true,
        message: 'Documents uploaded successfully',
        data: {
          registrationId,
          uploadedDocuments: uploadedDocs,
          status: 'documents_uploaded',
          nextStep: 'verification_pending'
        }
      });

    } catch (error) {
      console.error('Error uploading documents:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload documents',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Get documents for a registration
  getDocuments: async (req, res) => {
    try {
      const { registrationId } = req.params;

      const documents = await KYCDocument.findAll({
        where: { registrationId },
        attributes: ['id', 'documentType', 'originalFileName', 'verificationStatus', 'rejectionReason', 'createdAt'],
        order: [['createdAt', 'ASC']]
      });

      res.status(200).json({
        success: true,
        data: {
          registrationId,
          documents
        }
      });

    } catch (error) {
      console.error('Error fetching documents:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch documents',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Update document verification status (admin only)
  updateVerificationStatus: async (req, res) => {
    try {
      const { documentId } = req.params;
      const { status, rejectionReason } = req.body;

      const document = await KYCDocument.findByPk(documentId);
      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found'
        });
      }

      const updateData = {
        verificationStatus: status,
        verifiedBy: req.user?.id,
        verifiedAt: new Date()
      };

      if (status === 'rejected' && rejectionReason) {
        updateData.rejectionReason = rejectionReason;
      }

      await document.update(updateData);

      res.status(200).json({
        success: true,
        message: 'Document verification status updated',
        data: {
          documentId,
          status,
          verifiedAt: updateData.verifiedAt
        }
      });

    } catch (error) {
      console.error('Error updating verification status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update verification status',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
};

module.exports = kycController;