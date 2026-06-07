const User = require('../models/User');
const { validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

// Configure multer for individual file uploads
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
    cb(null, `${req.user.id}-${file.fieldname}-${uniqueSuffix}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Allow all common image formats and PDF
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'image/heic',
    'image/heif',
    'application/pdf'
  ];

  // Also check file extension as a fallback for MIME type detection issues
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.heic', '.heif', '.pdf'];
  const fileExtension = path.extname(file.originalname).toLowerCase();

  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image files (JPEG, PNG, GIF, WebP, BMP, TIFF, SVG, HEIC) and PDF are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Standardized API Response Helper (matching Rivenapp pattern)
const ApiResponse = {
  SuccessWithData: (data, message = "Success", statusCode = 200) => ({
    success: true,
    message,
    data,
    statusCode
  }),
  SuccessNoData: (message = "Success", statusCode = 200) => ({
    success: true,
    message,
    statusCode
  }),
  Error: (message, statusCode = 400, errors = null) => ({
    success: false,
    message,
    statusCode,
    errors
  })
};

const onboardingController = {
  // Get current user with personal details (matching Rivenapp pattern)
  getCurrentUserPersonalDetails: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ['password', 'pin_hash', 'login_attempts', 'lock_until'] }
      });

      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const personalDetails = {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        address: user.address ? JSON.parse(user.address) : null,
        city: user.city,
        postalCode: user.postal_code,
        streetAddress: user.address ? JSON.parse(user.address)?.streetAddress : null,
        occupation: user.occupation,
        kycStatus: user.kyc_status,
        registrationStep: user.registration_step,
        registrationStatus: user.registration_status,
        termsAccepted: user.terms_accepted,
        privacyAccepted: user.privacy_accepted,
        kycData: user.kyc_data || {}
      };

      return res.status(200).json(
        ApiResponse.SuccessWithData(personalDetails, "Current user fetched with personal details")
      );

    } catch (error) {
      logger.error('Error fetching current user personal details:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while fetching the current user', 500)
      );
    }
  },

  // Submit personal details (simplified format)
  submitPersonalDetails: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const {
        city,
        postalCode,
        apartment,
        streetAddress
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      // Define step hierarchy for comparison (updated flow with new steps)
      const stepHierarchy = {
        'email_verification': 0,
        'personal_info': 1,
        'employment_info': 2,
        'source_of_wealth': 3,
        'investing_savings': 4,
        'disclosures': 5,
        'tax_info': 6,
        'kyc_verification': 7,
        'investment_experience': 8,
        'documents': 9,
        'documents_id_front': 9,
        'documents_id_back': 10,
        'documents_proof_address': 11,
        'agreements': 12,
        'completed': 13
      };

      // Only advance to employment_info if user hasn't progressed beyond it
      const currentStepLevel = stepHierarchy[user.registration_step] || 1;
      const employmentStepLevel = stepHierarchy['employment_info'];
      const nextStep = currentStepLevel <= employmentStepLevel ? 'employment_info' : user.registration_step;

      const addressData = {
        city,
        postalCode,
        apartment: apartment || null,
        streetAddress: streetAddress || null
      };

      await user.update({
        address: JSON.stringify(addressData),
        city,
        postal_code: postalCode,
        registration_step: nextStep,
        registration_status: currentStepLevel <= employmentStepLevel ? 'email_verified' : user.registration_status
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('Personal details submitted successfully')
      );

    } catch (error) {
      logger.error('Error submitting personal details:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while submitting personal details', 500)
      );
    }
  },

  // Submit employment information (simplified format)
  submitEmploymentInfo: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const {
        employmentStatus,
        employerName,
        jobTitle,
        country
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const employmentData = {
        status: employmentStatus,
        employerName: employerName || null,
        jobTitle: jobTitle || null,
        country: country || null,
        updatedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        employment: employmentData
      };

      await user.update({
        occupation: jobTitle || null,
        kyc_data: updatedKycData,
        registration_step: 'source_of_wealth'  // Step 3: Source of Wealth
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('Employment information submitted successfully')
      );

    } catch (error) {
      logger.error('Error submitting employment information:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while submitting employment information', 500)
      );
    }
  },

  // Submit source of wealth (Step 3)
  submitSourceOfWealth: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const { sourceOfWealth, selectedOption } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const sourceOfWealthData = {
        sourceOfWealth,
        selectedOption,
        updatedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        sourceOfWealth: sourceOfWealthData
      };

      await user.update({
        kyc_data: updatedKycData,
        registration_step: 'investing_savings'  // Move to Step 4: Investing Savings
      });

      logger.info(`User ${user.id} completed source of wealth step`);

      return res.status(200).json(
        ApiResponse.SuccessNoData('Source of wealth submitted successfully')
      );

    } catch (error) {
      logger.error('Error submitting source of wealth:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while submitting source of wealth', 500)
      );
    }
  },

  // Submit investing savings (Step 4)
  submitInvestingSavings: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const { investingWithSavings, selectedOption } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const investingSavingsData = {
        investingWithSavings,
        selectedOption,
        updatedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        investingSavings: investingSavingsData
      };

      await user.update({
        kyc_data: updatedKycData,
        registration_step: 'disclosures'  // Move to Step 5: Disclosures
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('Investing savings submitted successfully')
      );

    } catch (error) {
      logger.error('Error submitting investing savings:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while submitting investing savings', 500)
      );
    }
  },

  // Submit disclosures (Step 5)
  submitDisclosures: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const {
        affiliatedWithBrokerDealer,
        publiclyTradedCompany,
        politicallyExposedPerson,
        familyOfPoliticalFigure,
        noneApply,
        selectedDisclosure
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const disclosuresData = {
        affiliatedWithBrokerDealer: affiliatedWithBrokerDealer || false,
        publiclyTradedCompany: publiclyTradedCompany || false,
        politicallyExposedPerson: politicallyExposedPerson || false,
        familyOfPoliticalFigure: familyOfPoliticalFigure || false,
        noneApply: noneApply || false,
        selectedDisclosure,
        updatedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        disclosures: disclosuresData
      };

      await user.update({
        kyc_data: updatedKycData,
        registration_step: 'tax_info'  // Move to Step 6: Tax Information
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('Disclosures submitted successfully')
      );

    } catch (error) {
      logger.error('Error submitting disclosures:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while submitting disclosures', 500)
      );
    }
  },

  // Submit investment experience (Step 8)
  submitInvestmentExperience: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const { investmentExperience, selectedOption } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const investmentExperienceData = {
        investmentExperience,
        selectedOption,
        updatedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        investmentExperience: investmentExperienceData
      };

      await user.update({
        kyc_data: updatedKycData,
        registration_step: 'kyc_verification'  // Move to KYC Verification
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('Investment experience submitted successfully')
      );

    } catch (error) {
      logger.error('Error submitting investment experience:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while submitting investment experience', 500)
      );
    }
  },

  // Upload tax document with tax ID
  uploadTaxDocumentMiddleware: upload.any(),
  uploadTaxDocument: async (req, res) => {
    try {
      const { taxId, taxIdType } = req.body;
      const file = req.files && req.files.length > 0 ? req.files[0] : null;

      if (!taxId || !taxIdType) {
        return res.status(400).json(ApiResponse.Error('Tax ID and Tax ID Type are required', 400));
      }

      if (!file) {
        return res.status(400).json(ApiResponse.Error('Tax document is required', 400));
      }

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const documentId = `${user.id}_tax_doc_${Date.now()}`;

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        taxInfo: {
          taxId,
          taxIdType,
          document: {
            documentId,
            fileName: file.filename,
            originalName: file.originalname,
            path: file.path,
            uploadedAt: new Date(),
            status: 'uploaded',
            verificationStatus: 'pending'
          },
          updatedAt: new Date()
        }
      };

      await user.update({
        kyc_data: updatedKycData,
        registration_step: 'kyc_verification'  // Move to Step 4: KYC
      });

      return res.status(200).json(
        ApiResponse.SuccessWithData(documentId, 'Tax document uploaded successfully')
      );

    } catch (error) {
      logger.error('Error uploading tax document:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while uploading tax document', 500)
      );
    }
  },

  // Submit KYC information (simplified format)
  submitKycInfo: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const {
        idType,
        idNumber,
        idExpiryDate,
        nationality
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const kycData = {
        idType,
        idNumber,
        idExpiryDate: idExpiryDate || null,
        nationality,
        updatedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        kyc: kycData
      };

      await user.update({
        kyc_data: updatedKycData,
        kyc_status: 'pending',
        registration_step: 'documents_id_front'  // Step 4: ID FRONT
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('KYC info submitted successfully')
      );

    } catch (error) {
      logger.error('Error submitting kyc info:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while submitting kyc info', 500)
      );
    }
  },

  // Submit trusted contact (matching Rivenapp pattern)
  submitTrustedContact: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const {
        fullName,
        relationship,
        email,
        phoneNumber,
        address
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const trustedContactData = {
        fullName,
        relationship,
        email,
        phoneNumber,
        address,
        updatedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        trustedContact: trustedContactData
      };

      await user.update({
        kyc_data: updatedKycData,
        registration_step: 'documents_id_front'  // Step 5: ID FRONT (first document)
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('Trusted contact info submitted successfully')
      );

    } catch (error) {
      logger.error('Error submitting trusted contact information:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while submitting trusted contact information', 500)
      );
    }
  },

  // Upload ID front (matching Rivenapp pattern)
  uploadIdFrontMiddleware: upload.any(),
  uploadIdFront: async (req, res) => {
    try {
      const file = req.files && req.files.length > 0 ? req.files[0] : null;
      if (!file) {
        return res.status(400).json(ApiResponse.Error('No file uploaded', 400));
      }

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const documentId = `${user.id}_id_front_${Date.now()}`;

      const currentKycData = user.kyc_data || {};
      const updatedDocuments = {
        ...currentKycData.documents,
        idFront: {
          documentId,
          fileName: file.filename,
          originalName: file.originalname,
          path: file.path,
          uploadedAt: new Date(),
          status: 'uploaded',
          verificationStatus: 'pending'
        }
      };

      const updatedKycData = {
        ...currentKycData,
        documents: updatedDocuments
      };

      // After uploading ID Front, move to ID Back step
      const nextStep = 'documents_id_back';

      await user.update({
        kyc_data: updatedKycData,
        registration_step: nextStep
      });

      return res.status(200).json(
        ApiResponse.SuccessWithData(documentId, 'Document uploaded successfully')
      );

    } catch (error) {
      logger.error('Error uploading ID front document:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while uploading document', 500)
      );
    }
  },

  // Upload ID back (matching Rivenapp pattern)
  uploadIdBackMiddleware: upload.any(),
  uploadIdBack: async (req, res) => {
    try {
      const file = req.files && req.files.length > 0 ? req.files[0] : null;
      if (!file) {
        return res.status(400).json(ApiResponse.Error('No file uploaded', 400));
      }

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const documentId = `${user.id}_id_back_${Date.now()}`;

      const currentKycData = user.kyc_data || {};
      const updatedDocuments = {
        ...currentKycData.documents,
        idBack: {
          documentId,
          fileName: file.filename,
          originalName: file.originalname,
          path: file.path,
          uploadedAt: new Date(),
          status: 'uploaded',
          verificationStatus: 'pending'
        }
      };

      const updatedKycData = {
        ...currentKycData,
        documents: updatedDocuments
      };

      // After uploading ID Back, move to Proof of Address step
      const nextStep = 'documents_proof_address';

      await user.update({
        kyc_data: updatedKycData,
        registration_step: nextStep
      });

      return res.status(200).json(
        ApiResponse.SuccessWithData(documentId, 'Document uploaded successfully')
      );

    } catch (error) {
      logger.error('Error uploading ID back document:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while uploading document', 500)
      );
    }
  },

  // Upload proof of address - flexible field name middleware
  uploadProofOfAddressMiddleware: upload.any(),
  uploadProofOfAddress: async (req, res) => {
    try {
      // With .any(), files are in req.files array
      const files = req.files;
      if (!files || files.length === 0) {
        return res.status(400).json(ApiResponse.Error('No file uploaded', 400));
      }

      // Take the first file (should only be one for single file upload)
      const file = files[0];

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const documentId = `${user.id}_proof_of_address_${Date.now()}`;

      const currentKycData = user.kyc_data || {};
      const updatedDocuments = {
        ...currentKycData.documents,
        proofOfAddress: {
          documentId,
          fileName: file.filename,
          originalName: file.originalname,
          path: file.path,
          uploadedAt: new Date(),
          status: 'uploaded',
          verificationStatus: 'pending'
        }
      };

      const updatedKycData = {
        ...currentKycData,
        documents: updatedDocuments
      };

      // After uploading Proof of Address, move to agreements step
      const nextStep = 'agreements';

      await user.update({
        kyc_data: updatedKycData,
        registration_step: nextStep
      });

      return res.status(200).json(
        ApiResponse.SuccessWithData(documentId, 'Document uploaded successfully')
      );

    } catch (error) {
      logger.error('Error uploading proof of address document:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while uploading document', 500)
      );
    }
  },

  // Accept agreements (matching Rivenapp pattern)
  acceptAgreements: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const { termsAndConditions } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      // Auto-fill all agreement fields when termsAndConditions is accepted
      const ipAddress = req.connection?.remoteAddress || req.ip || req.get('x-forwarded-for') || '127.0.0.1';
      const userAgent = req.get('User-Agent') || 'Unknown';
      const timestamp = new Date().toISOString();

      const agreementData = {
        termsAndConditions: true,
        privacyPolicy: true,
        dataProcessingConsent: true,
        marketingConsent: req.body.marketingConsent || false, // Optional marketing consent
        agreementVersion: '1.0',
        ipAddress,
        userAgent,
        timestamp,
        acceptedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        agreements: agreementData
      };

      await user.update({
        terms_accepted: true,
        privacy_accepted: true,
        terms_accepted_at: new Date(),
        privacy_accepted_at: new Date(),
        kyc_data: updatedKycData,
        registration_step: 'completed'  // Step 8: Completion (after agreements)
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('Agreements accepted successfully')
      );

    } catch (error) {
      logger.error('Error accepting agreements:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while accepting agreements', 500)
      );
    }
  },


  // Get application status (matching Rivenapp pattern)
  getApplicationStatus: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const status = {
        registrationStatus: user.registration_status,
        registrationStep: user.registration_step,
        kycStatus: user.kyc_status,
        accountStatus: user.account_status,
        alpacaAccountId: user.alpaca_account_id,
        isOnboardingComplete: user.registration_status === 'completed',
        canTrade: user.kyc_status === 'approved' && user.account_status === 'active'
      };

      return res.status(200).json(
        ApiResponse.SuccessWithData(status, 'Application status retrieved successfully')
      );

    } catch (error) {
      logger.error('Error getting application status:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while getting application status', 500)
      );
    }
  },

  // Get detailed application status (matching Rivenapp pattern)
  getDetailedApplicationStatus: async (req, res) => {
    try {
      const startTime = Date.now();
      logger.info(`Started getting detailed application status at ${new Date()}`);

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const kycData = user.kyc_data || {};

      const detailedStatus = {
        user: {
          id: user.id,
          email: user.email,
          fullName: `${user.first_name} ${user.last_name}`,
          registrationStatus: user.registration_status,
          registrationStep: user.registration_step,
          kycStatus: user.kyc_status,
          accountStatus: user.account_status
        },
        onboardingCompletion: {
          personalDetails: {
            completed: !!(user.date_of_birth && user.gender && user.address),
            data: {
              dateOfBirth: user.date_of_birth,
              gender: user.gender,
              address: user.address,
              city: user.city,
              county: user.county
            }
          },
          employment: {
            completed: !!kycData.employment,
            data: kycData.employment || null
          },
          kyc: {
            completed: !!kycData.kyc,
            data: kycData.kyc || null
          },
          documents: {
            completed: !!(kycData.documents?.idFront && kycData.documents?.idBack && kycData.documents?.proofOfAddress),
            data: kycData.documents || null
          },
          agreements: {
            completed: !!(user.terms_accepted && user.privacy_accepted),
            data: kycData.agreements || null
          }
        },
        alpacaAccount: {
          accountId: user.alpaca_account_id,
          status: user.account_status,
          tradingEnabled: user.kyc_status === 'approved' && user.account_status === 'active'
        }
      };

      const endTime = Date.now();
      const timeTaken = endTime - startTime;
      logger.info(`Finished getting detailed application status at ${new Date()}. Time taken: ${timeTaken} ms`);

      return res.status(200).json(
        ApiResponse.SuccessWithData(detailedStatus, 'Detailed application status retrieved successfully')
      );

    } catch (error) {
      logger.error('Error getting detailed application status:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while getting detailed application status', 500)
      );
    }
  },

  // Get onboarding progress (matching Rivenapp pattern)
  getOnboardingProgress: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const kycData = user.kyc_data || {};

      const steps = {
        personalDetails: !!(user.date_of_birth && user.gender && user.address),
        employment: !!kycData.employment,
        sourceOfWealth: !!kycData.sourceOfWealth,
        investingSavings: !!kycData.investingSavings,
        disclosures: !!kycData.disclosures,
        taxInfo: !!kycData.taxInfo,
        kyc: !!kycData.kyc,
        investmentExperience: !!kycData.investmentExperience,
        idFront: !!kycData.documents?.idFront,
        idBack: !!kycData.documents?.idBack,
        proofOfAddress: !!kycData.documents?.proofOfAddress,
        agreements: !!(user.terms_accepted && user.privacy_accepted),
        completion: user.registration_status === 'completed'
      };

      const completedSteps = Object.values(steps).filter(Boolean).length;
      const totalSteps = Object.keys(steps).length;
      const progressPercentage = Math.round((completedSteps / totalSteps) * 100);

      // Map registration steps to step numbers (updated flow with new steps)
      const stepMapping = {
        'email_verification': 0,       // Email verification is pre-onboarding (handled at login)
        'personal_info': 1,            // Step 1: Personal Details
        'employment_info': 2,          // Step 2: Employment
        'source_of_wealth': 3,         // Step 3: Source of Wealth
        'investing_savings': 4,        // Step 4: Investing Savings
        'disclosures': 5,              // Step 5: Disclosures
        'tax_info': 6,                 // Step 6: Tax Info
        'kyc_verification': 7,         // Step 7: KYC
        'investment_experience': 8,    // Step 8: Investment Experience
        'documents': 9,                // Step 9: ID FRONT (legacy)
        'documents_id_front': 9,       // Step 9: ID FRONT
        'documents_id_back': 10,       // Step 10: ID BACK
        'documents_proof_address': 11, // Step 11: PROOF OF ADDRESS
        'agreements': 12,              // Step 12: Accept Terms and Conditions
        'kyc_pending': 13,             // Step 13: Completion
        'kyc_under_review': 13,        // Step 13: Under Review
        'completed': 13,               // Step 13: Completed
        'initial_completed': 13        // Step 13: Initial Completed
      };

      let currentStepCount = stepMapping[user.registration_step];

      // Handle undefined registration steps
      if (currentStepCount === undefined) {
        currentStepCount = 1; // Default to step 1 (personal details)
      }

      // If email verification step, move to personal details (step 1)
      if (currentStepCount === 0) {
        currentStepCount = 1;  // Show Personal Details as first step after email verification
      }

      const progress = {
        currentStep: user.registration_step,
        currentStepCount,
        completedSteps,
        totalSteps,
        progressPercentage,
        isComplete: user.registration_status === 'completed',
        steps,
        alpacaKyc: {
          status: user.kyc_status,
          approved: user.kyc_status === 'approved',
          canTrade: user.kyc_status === 'approved' && user.account_status === 'active'
        }
      };

      return res.status(200).json(
        ApiResponse.SuccessWithData(progress, 'Onboarding progress retrieved successfully')
      );

    } catch (error) {
      logger.error('Error getting onboarding progress:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while getting onboarding progress', 500)
      );
    }
  },

  // Get detailed onboarding progress (matching Rivenapp pattern)
  getDetailedOnboardingProgress: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const kycData = user.kyc_data || {};

      const detailedProgress = {
        user: {
          id: user.id,
          email: user.email,
          fullName: `${user.first_name} ${user.last_name}`,
          currentStep: user.registration_step,
          status: user.registration_status
        },
        steps: [
          {
            stepNumber: 1,
            stepName: 'Personal Details',
            endpoint: '/api/v1/onboarding/personal-details',
            completed: !!(user.date_of_birth && user.gender && user.address),
            data: {
              firstName: user.first_name,
              lastName: user.last_name,
              dateOfBirth: user.date_of_birth,
              gender: user.gender,
              address: user.address,
              city: user.city,
              county: user.county
            }
          },
          {
            stepNumber: 2,
            stepName: 'Employment',
            endpoint: '/api/v1/onboarding/employment-info',
            completed: !!kycData.employment,
            data: kycData.employment || null
          },
          {
            stepNumber: 3,
            stepName: 'Source of Wealth',
            endpoint: '/api/v1/onboarding/source-of-wealth',
            completed: !!kycData.sourceOfWealth,
            data: kycData.sourceOfWealth || null
          },
          {
            stepNumber: 4,
            stepName: 'Investing Savings',
            endpoint: '/api/v1/onboarding/investing-savings',
            completed: !!kycData.investingSavings,
            data: kycData.investingSavings || null
          },
          {
            stepNumber: 5,
            stepName: 'Disclosures',
            endpoint: '/api/v1/onboarding/disclosures',
            completed: !!kycData.disclosures,
            data: kycData.disclosures || null
          },
          {
            stepNumber: 6,
            stepName: 'Tax Information',
            endpoint: '/api/v1/onboarding/tax-info',
            completed: !!kycData.taxInfo,
            data: kycData.taxInfo || null
          },
          {
            stepNumber: 7,
            stepName: 'KYC',
            endpoint: '/api/v1/onboarding/kyc-info',
            completed: !!kycData.kyc,
            data: kycData.kyc || null
          },
          {
            stepNumber: 8,
            stepName: 'Investment Experience',
            endpoint: '/api/v1/onboarding/investment-experience',
            completed: !!kycData.investmentExperience,
            data: kycData.investmentExperience || null
          },
          {
            stepNumber: 9,
            stepName: 'ID FRONT',
            endpoint: '/api/v1/onboarding/upload-id-front',
            completed: !!kycData.documents?.idFront,
            data: kycData.documents?.idFront || null
          },
          {
            stepNumber: 10,
            stepName: 'ID BACK',
            endpoint: '/api/v1/onboarding/upload-id-back',
            completed: !!kycData.documents?.idBack,
            data: kycData.documents?.idBack || null
          },
          {
            stepNumber: 11,
            stepName: 'PROOF OF ADDRESS',
            endpoint: '/api/v1/onboarding/upload-proof-of-address',
            completed: !!kycData.documents?.proofOfAddress,
            data: kycData.documents?.proofOfAddress || null
          },
          {
            stepNumber: 12,
            stepName: 'Accept Terms and Conditions',
            endpoint: '/api/v1/onboarding/agreements',
            completed: !!(user.terms_accepted && user.privacy_accepted),
            data: kycData.agreements || null
          },
          {
            stepNumber: 13,
            stepName: 'Completion',
            endpoint: '/api/v1/onboarding/complete',
            completed: user.registration_status === 'completed',
            data: {
              submittedAt: user.registration_status === 'completed' ? user.updatedAt : null
            }
          }
        ],
        summary: {
          completedSteps: kycData ? Object.values({
            personalDetails: !!(user.date_of_birth && user.gender && user.address),
            employment: !!kycData.employment,
            sourceOfWealth: !!kycData.sourceOfWealth,
            investingSavings: !!kycData.investingSavings,
            disclosures: !!kycData.disclosures,
            taxInfo: !!kycData.taxInfo,
            kyc: !!kycData.kyc,
            investmentExperience: !!kycData.investmentExperience,
            idFront: !!kycData.documents?.idFront,
            idBack: !!kycData.documents?.idBack,
            proofOfAddress: !!kycData.documents?.proofOfAddress,
            agreements: !!(user.terms_accepted && user.privacy_accepted),
            completion: user.registration_status === 'completed'
          }).filter(Boolean).length : 0,
          totalSteps: 13,
          isComplete: user.registration_status === 'completed',
          kycStatus: user.kyc_status,
          accountStatus: user.account_status
        }
      };

      return res.status(200).json(
        ApiResponse.SuccessWithData(detailedProgress, 'Onboarding progress retrieved successfully')
      );

    } catch (error) {
      logger.error('Error getting detailed onboarding progress:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while getting detailed onboarding progress', 500)
      );
    }
  },

  // Complete Onboarding (original pattern with Alpaca account creation)
  completeOnboarding: async (req, res) => {
    try {
      const { confirmCompletion } = req.body;

      if (!confirmCompletion) {
        return res.status(400).json(
          ApiResponse.Error('Cannot complete onboarding', 400, ['Completion confirmation required'])
        );
      }

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      // Check if all previous steps are completed
      const kycData = user.kyc_data || {};
      const missingSteps = [];

      // Check personal details
      if (!user.date_of_birth || !user.gender || !user.address) {
        missingSteps.push('Personal details not completed');
      }

      // Check employment details
      if (!kycData.employment) {
        missingSteps.push('Employment details not completed');
      }

      // Check KYC information
      if (!kycData.kyc) {
        missingSteps.push('KYC information not completed');
      }

      // Check documents
      if (!kycData.documents) {
        missingSteps.push('Documents not uploaded');
      }

      // Check agreements
      if (!user.terms_accepted || !user.privacy_accepted) {
        missingSteps.push('Agreements not accepted');
      }

      if (missingSteps.length > 0) {
        return res.status(400).json(
          ApiResponse.Error('Cannot complete onboarding', 400, missingSteps)
        );
      }

      // Prepare user data for Alpaca account creation
      let updates = {
        registration_status: 'completed',
        registration_step: 'completed',
        account_status: 'active',
        kyc_status: 'pending'
      };

      let alpacaAccountCreated = false;
      let alpacaError = null;

      // Create Alpaca account
      try {
        // Import alpaca service
        const alpacaService = require('../services/alpacaService');

        // Parse address from stored JSON
        const addressData = JSON.parse(user.address);

        const alpacaAccountData = {
          // Personal information
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          phone: user.phone,
          dateOfBirth: user.date_of_birth instanceof Date
            ? user.date_of_birth.toISOString().split('T')[0]
            : user.date_of_birth,

          // Address information
          address: {
            street: addressData.street,
            city: addressData.city,
            state: addressData.state,
            country: addressData.country,
            postalCode: addressData.zipCode
          },

          // KYC information
          identity: {
            idType: kycData.kyc.idType,
            idNumber: kycData.kyc.idNumber,
            idExpiryDate: kycData.kyc.idExpiryDate,
            nationality: kycData.kyc.nationality,
            placeOfBirth: kycData.kyc.placeOfBirth
          },

          // Employment information
          employment: {
            status: kycData.employment.status,
            employerName: kycData.employment.employerName,
            jobTitle: kycData.employment.jobTitle,
            monthlyIncome: kycData.employment.monthlyIncome,
            yearsAtCurrentJob: kycData.employment.yearsAtCurrentJob
          },

          // Financial profile
          financial: {
            purposeOfAccount: kycData.kyc.purposeOfAccount,
            sourceOfFunds: kycData.kyc.sourceOfFunds,
            expectedTransactionVolume: kycData.kyc.expectedTransactionVolume
          },

          // Trusted contact (optional - only include if provided)
          trustedContact: kycData.trustedContact ? {
            fullName: kycData.trustedContact.fullName,
            relationship: kycData.trustedContact.relationship,
            email: kycData.trustedContact.email,
            phoneNumber: kycData.trustedContact.phoneNumber,
            address: kycData.trustedContact.address
          } : null,

          // Compliance information
          citizenship: user.citizenship,
          taxId: kycData.kyc.idNumber, // Using ID number as tax ID for now

          // Agreement acceptance
          agreements: {
            termsAccepted: user.terms_accepted,
            privacyAccepted: user.privacy_accepted,
            termsAcceptedAt: user.terms_accepted_at,
            privacyAcceptedAt: user.privacy_accepted_at
          }
        };

        logger.info('Creating Alpaca account with data:', JSON.stringify(alpacaAccountData, null, 2));

        // Try to create account via Broker API
        let alpacaAccountId = null;
        try {
          const alpacaAccount = await alpacaService.createAccount(alpacaAccountData);
          alpacaAccountId = alpacaAccount.id;
        } catch (brokerError) {
          // Log the error - user will proceed without Alpaca account
          // They can retry onboarding or it can be set up manually later
          logger.error('Broker API account creation failed:', brokerError.message);

          // REMOVED: Don't fallback to master trading account - causes unique constraint violations
          // The master account ID is shared and can't be assigned to individual users
          // logger.info('Broker API account creation failed, checking for existing account');
          // try {
          //   const existingAccount = await alpacaService.getAccount();
          //   if (existingAccount && existingAccount.account_number) {
          //     alpacaAccountId = existingAccount.account_number;
          //     logger.info('Found existing Alpaca account:', alpacaAccountId);
          //   }
          // } catch (accountError) {
          //   logger.warn('Could not retrieve existing account:', accountError.message);
          // }
        }

        if (alpacaAccountId) {
          updates.alpaca_account_id = alpacaAccountId;
        }

        // Get initial status from Alpaca
        try {
          if (alpacaAccountId) {
            const alpacaStatus = await alpacaService.getAccountStatus(alpacaAccountId);
            updates.kyc_status = alpacaStatus.kycStatus;
            logger.info(`Alpaca account status: ${alpacaStatus.status} -> KYC: ${alpacaStatus.kycStatus}`);
          }
        } catch (statusError) {
          logger.warn('Could not get initial Alpaca status, defaulting to submitted:', statusError.message);
          updates.kyc_status = 'submitted';
        }

        alpacaAccountCreated = true;

        logger.info(`Alpaca account created successfully: ${alpacaAccountId}`);

      } catch (error) {
        logger.error('Error creating Alpaca account:', error);
        alpacaError = error.message;

        // Don't fail onboarding if Alpaca account creation fails
        // Set KYC status to under_review for manual processing
        updates.kyc_status = 'under_review';
        updates.registration_step = 'kyc_under_review';
      }

      // Update user with final status
      await user.update(updates);

      // Auto-create wallet for the user
      try {
        const { Wallet } = require('../models/Wallet');

        // Check if wallet already exists
        let wallet = await Wallet.findOne({
          where: { user_id: user.id }
        });

        if (!wallet) {
          // Create a new wallet with initial balances
          wallet = await Wallet.create({
            user_id: user.id,
            kes_balance: 0,
            usd_balance: 0,
            frozen_kes: 0,
            frozen_usd: 0
          });

          logger.info(`Auto-created wallet for user ${user.id} on onboarding completion`);
        } else {
          logger.info(`Wallet already exists for user ${user.id}`);
        }
      } catch (walletError) {
        logger.error('Error auto-creating wallet:', walletError);
        // Don't fail onboarding if wallet creation fails - it can be created later
      }

      // SANDBOX: Auto-approve KYC in development environments
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'testing') {
        try {
          // Force approve KYC for instant testing
          await user.update({
            kyc_status: 'approved',
            account_status: 'active'
          });

          // Update the response updates object to reflect the sandbox approval
          updates.kyc_status = 'approved';
          updates.account_status = 'active';

          logger.info(`SANDBOX: Auto-approved KYC for user ${user.email} on onboarding completion`);
        } catch (sandboxError) {
          logger.warn('Error auto-approving KYC in sandbox:', sandboxError);
          // Don't fail onboarding if KYC auto-approval fails
        }
      }

      // Send success response
      const responseData = {
        onboardingComplete: true,
        accountStatus: updates.account_status,
        kycStatus: updates.kyc_status,
        welcomeBonus: {
          amount: 10.00,
          currency: 'USD'
        }
      };

      // Add Alpaca account info if created successfully or sandbox approved
      const isSandboxApproved = (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'testing') && updates.kyc_status === 'approved';

      if (alpacaAccountCreated) {
        responseData.alpacaAccountId = updates.alpaca_account_id;
        responseData.tradingEnabled = true;
      } else if (isSandboxApproved) {
        responseData.tradingEnabled = true;
        responseData.note = 'Sandbox mode: KYC auto-approved for testing. Trading enabled immediately.';
        responseData.sandboxMode = true;
      } else {
        responseData.tradingEnabled = false;
        responseData.note = 'Trading account setup in progress. You will be notified when ready.';
        if (alpacaError) {
          responseData.alpacaError = process.env.NODE_ENV === 'development' ? alpacaError : 'Account setup pending';
        }
      }

      // Send completion email
      try {
        const emailService = require('../services/emailService');
        await emailService.sendOnboardingCompleteEmail(user, alpacaAccountCreated);
      } catch (emailError) {
        logger.warn('Failed to send onboarding completion email:', emailError);
      }

      let successMessage = 'Onboarding completed successfully!';

      if (alpacaAccountCreated) {
        successMessage += ' Your trading account is ready.';
      } else if (isSandboxApproved) {
        successMessage += ' KYC auto-approved for sandbox testing. Trading enabled immediately.';
      } else {
        successMessage += ' Your trading account is being set up.';
      }

      return res.status(200).json(
        ApiResponse.SuccessWithData(responseData, successMessage)
      );

    } catch (error) {
      logger.error('Error completing onboarding:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while completing onboarding', 500)
      );
    }
  },

  // SANDBOX/TEST ONLY: Force approve KYC for testing
  sandboxApproveKyc: async (req, res) => {
    try {
      // Only allow in development/test environments
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json(
          ApiResponse.Error('This endpoint is not available in production', 403)
        );
      }

      const { userId } = req.params;
      const targetUserId = userId || req.user.id;

      const user = await User.findByPk(targetUserId);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      // Only approve users who have completed onboarding
      if (user.registration_status !== 'completed') {
        return res.status(400).json(
          ApiResponse.Error('User must complete onboarding before KYC approval', 400)
        );
      }

      // Update KYC status to approved
      await user.update({
        kyc_status: 'approved',
        account_status: 'active'
      });

      logger.info(`SANDBOX: Force approved KYC for user ${user.email} (ID: ${user.id})`);

      return res.status(200).json(
        ApiResponse.SuccessWithData({
          userId: user.id,
          email: user.email,
          kycStatus: 'approved',
          accountStatus: 'active',
          canTrade: true,
          approvedAt: new Date().toISOString(),
          note: 'KYC force-approved for sandbox testing'
        }, 'KYC approval simulated successfully')
      );

    } catch (error) {
      logger.error('Error in sandbox KYC approval:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred during sandbox KYC approval', 500)
      );
    }
  },

  // SANDBOX/TEST ONLY: Bulk approve all pending KYC accounts
  sandboxApproveAllKyc: async (req, res) => {
    try {
      // Only allow in development/test environments
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json(
          ApiResponse.Error('This endpoint is not available in production', 403)
        );
      }

      // Find all completed users with pending/submitted KYC
      const pendingUsers = await User.findAll({
        where: {
          registration_status: 'completed',
          kyc_status: ['pending', 'submitted', 'under_review']
        },
        attributes: ['id', 'email', 'kyc_status', 'account_status']
      });

      if (pendingUsers.length === 0) {
        return res.status(200).json(
          ApiResponse.SuccessWithData({
            approvedCount: 0,
            message: 'No pending KYC accounts found'
          }, 'No accounts to approve')
        );
      }

      // Approve all pending accounts
      const approvedUserIds = [];
      for (const user of pendingUsers) {
        await user.update({
          kyc_status: 'approved',
          account_status: 'active'
        });
        approvedUserIds.push({
          id: user.id,
          email: user.email,
          previousStatus: user.kyc_status
        });
      }

      logger.info(`SANDBOX: Bulk approved ${pendingUsers.length} KYC accounts`);

      return res.status(200).json(
        ApiResponse.SuccessWithData({
          approvedCount: pendingUsers.length,
          approvedUsers: approvedUserIds,
          approvedAt: new Date().toISOString(),
          note: 'All pending KYC accounts force-approved for sandbox testing'
        }, 'Bulk KYC approval completed successfully')
      );

    } catch (error) {
      logger.error('Error in sandbox bulk KYC approval:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred during sandbox bulk KYC approval', 500)
      );
    }
  },

  // Get user settings
  getUserSettings: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const settings = {
        pinEnabled: user.pin_enabled || false,
        biometricEnabled: user.biometric_enabled || false,
        twoFactorEnabled: user.two_factor_enabled || false,
        autoConvertDeposits: user.auto_convert_deposits !== false,
        securityPreferences: user.security_preferences || {
          require_biometric_for_login: false,
          require_biometric_for_transactions: true,
          biometric_timeout_minutes: 15
        }
      };

      return res.status(200).json(
        ApiResponse.SuccessWithData(settings, 'User settings retrieved successfully')
      );

    } catch (error) {
      logger.error('Error getting user settings:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while getting user settings', 500)
      );
    }
  },

  // Update user settings
  updateUserSettings: async (req, res) => {
    try {
      const {
        pinEnabled,
        biometricEnabled,
        twoFactorEnabled,
        autoConvertDeposits,
        securityPreferences
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const updates = {};

      // Update pinEnabled
      if (typeof pinEnabled === 'boolean') {
        updates.pin_enabled = pinEnabled;
        // If disabling PIN and user wants to clear it
        if (!pinEnabled) {
          // Optionally clear the PIN hash when disabled
          // updates.pin_hash = null;
        }
      }

      // Update biometricEnabled
      if (typeof biometricEnabled === 'boolean') {
        updates.biometric_enabled = biometricEnabled;
      }

      // Update twoFactorEnabled
      if (typeof twoFactorEnabled === 'boolean') {
        updates.two_factor_enabled = twoFactorEnabled;
      }

      // Update autoConvertDeposits
      if (typeof autoConvertDeposits === 'boolean') {
        updates.auto_convert_deposits = autoConvertDeposits;
      }

      // Update security preferences
      if (securityPreferences && typeof securityPreferences === 'object') {
        const currentPrefs = user.security_preferences || {};
        updates.security_preferences = {
          ...currentPrefs,
          ...securityPreferences
        };
      }

      // Only update if there are changes
      if (Object.keys(updates).length === 0) {
        return res.status(400).json(
          ApiResponse.Error('No valid settings provided to update', 400)
        );
      }

      await user.update(updates);

      // Return updated settings
      const updatedSettings = {
        pinEnabled: user.pin_enabled || false,
        biometricEnabled: user.biometric_enabled || false,
        twoFactorEnabled: user.two_factor_enabled || false,
        autoConvertDeposits: user.auto_convert_deposits !== false,
        securityPreferences: user.security_preferences || {}
      };

      logger.info(`User ${user.id} updated settings:`, Object.keys(updates));

      return res.status(200).json(
        ApiResponse.SuccessWithData(updatedSettings, 'User settings updated successfully')
      );

    } catch (error) {
      logger.error('Error updating user settings:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while updating user settings', 500)
      );
    }
  },

  getDocument: async (req, res) => {
    try {
      const { filename } = req.params;
      const userId = req.user.id;

      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json(
          ApiResponse.Error('Invalid filename', 400)
        );
      }

      
      const isAdmin = req.user.role === 'admin' || req.user.role === 'support';
      if (!isAdmin && !filename.startsWith(`${userId}-`)) {
        return res.status(403).json(
          ApiResponse.Error('Access denied. You can only access your own documents.', 403)
        );
      }

      // Construct the file path
      const filePath = path.join(__dirname, '../../uploads/kyc', filename);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return res.status(404).json(
          ApiResponse.Error('Document not found', 404)
        );
      }

      // Determine content type based on file extension
      const ext = path.extname(filename).toLowerCase();
      const contentTypeMap = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff',
        '.svg': 'image/svg+xml',
        '.heic': 'image/heic',
        '.heif': 'image/heif'
      };

      const contentType = contentTypeMap[ext] || 'application/octet-stream';

      // Set content type and send file
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

      return res.sendFile(filePath);

    } catch (error) {
      logger.error('Error serving document:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while retrieving the document', 500)
      );
    }
  }
};

module.exports = onboardingController;