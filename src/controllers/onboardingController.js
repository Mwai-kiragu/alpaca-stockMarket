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
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
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
        dateOfBirth: user.date_of_birth,
        gender: user.gender,
        address: user.address ? JSON.parse(user.address) : null,
        city: user.city,
        county: user.county,
        postalCode: user.postal_code,
        citizenship: user.citizenship,
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

  // Submit personal details (matching Rivenapp pattern)
  submitPersonalDetails: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json(
          ApiResponse.Error('Validation failed', 400, errors.array())
        );
      }

      const {
        firstName,
        lastName,
        dateOfBirth,
        gender,
        address,
        city,
        county,
        postalCode,
        citizenship
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      await user.update({
        first_name: firstName,
        last_name: lastName,
        date_of_birth: new Date(dateOfBirth),
        gender: gender.toLowerCase(),
        address: JSON.stringify(address),
        city,
        county,
        postal_code: postalCode,
        citizenship,
        registration_step: 'personal_info'
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

  // Submit employment information (matching Rivenapp pattern)
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
        monthlyIncome,
        workAddress,
        yearsAtCurrentJob,
        industryType
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const employmentData = {
        status: employmentStatus,
        employerName,
        jobTitle,
        monthlyIncome,
        workAddress,
        yearsAtCurrentJob,
        industryType,
        updatedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        employment: employmentData
      };

      await user.update({
        occupation: jobTitle,
        kyc_data: updatedKycData,
        registration_step: 'employment_info'
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

  // Submit KYC information (matching Rivenapp pattern)
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
        nationality,
        placeOfBirth,
        purposeOfAccount,
        sourceOfFunds,
        expectedTransactionVolume,
        investmentExperience,
        riskTolerance,
        publiclyTradedCompany,
        politicallyExposedPerson
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const kycData = {
        idType,
        idNumber,
        idExpiryDate,
        nationality,
        placeOfBirth,
        purposeOfAccount,
        sourceOfFunds,
        expectedTransactionVolume,
        investmentExperience,
        riskTolerance,
        publiclyTradedCompany: publiclyTradedCompany || false,
        politicallyExposedPerson: politicallyExposedPerson || false,
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
        registration_step: 'kyc_info'
      });

      return res.status(200).json(
        ApiResponse.SuccessNoData('Alpaca specific kyc info submitted successfully')
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
        registration_step: 'trusted_contact'
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
  uploadIdFrontMiddleware: upload.single('DocumentFile'),
  uploadIdFront: async (req, res) => {
    try {
      const file = req.file;
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

      await user.update({
        kyc_data: updatedKycData
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
  uploadIdBackMiddleware: upload.single('DocumentFile'),
  uploadIdBack: async (req, res) => {
    try {
      const file = req.file;
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

      await user.update({
        kyc_data: updatedKycData
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

  // Upload proof of address (matching Rivenapp pattern)
  uploadProofOfAddressMiddleware: upload.single('DocumentFile'),
  uploadProofOfAddress: async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json(ApiResponse.Error('No file uploaded', 400));
      }

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

      await user.update({
        kyc_data: updatedKycData,
        registration_step: 'documents_uploaded'
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

      const {
        termsAndConditions,
        privacyPolicy,
        dataProcessingConsent,
        marketingConsent
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(ApiResponse.Error('User not found', 404));
      }

      const ipAddress = req.connection?.remoteAddress || req.ip || '';
      const userAgent = req.get('User-Agent') || '';

      const agreementData = {
        termsAndConditions,
        privacyPolicy,
        dataProcessingConsent,
        marketingConsent,
        ipAddress,
        userAgent,
        acceptedAt: new Date()
      };

      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        agreements: agreementData
      };

      await user.update({
        terms_accepted: termsAndConditions,
        privacy_accepted: privacyPolicy,
        terms_accepted_at: new Date(),
        privacy_accepted_at: new Date(),
        kyc_data: updatedKycData,
        registration_step: 'agreements_accepted'
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
          trustedContact: {
            completed: !!kycData.trustedContact,
            data: kycData.trustedContact || null
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
        kyc: !!kycData.kyc,
        trustedContact: !!kycData.trustedContact,
        documents: !!(kycData.documents?.idFront && kycData.documents?.idBack && kycData.documents?.proofOfAddress),
        agreements: !!(user.terms_accepted && user.privacy_accepted),
        applicationSubmitted: user.registration_status === 'completed'
      };

      const completedSteps = Object.values(steps).filter(Boolean).length;
      const totalSteps = Object.keys(steps).length;
      const progressPercentage = Math.round((completedSteps / totalSteps) * 100);

      const progress = {
        currentStep: user.registration_step,
        completedSteps,
        totalSteps,
        progressPercentage,
        isComplete: user.registration_status === 'completed',
        steps
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
            stepName: 'Employment Information',
            endpoint: '/api/v1/onboarding/employment-info',
            completed: !!kycData.employment,
            data: kycData.employment || null
          },
          {
            stepNumber: 3,
            stepName: 'KYC Information',
            endpoint: '/api/v1/onboarding/kyc-info',
            completed: !!kycData.kyc,
            data: kycData.kyc || null
          },
          {
            stepNumber: 4,
            stepName: 'Trusted Contact',
            endpoint: '/api/v1/onboarding/trusted-contact',
            completed: !!kycData.trustedContact,
            data: kycData.trustedContact || null
          },
          {
            stepNumber: 5,
            stepName: 'Document Upload',
            endpoint: '/api/v1/onboarding/upload-documents',
            completed: !!(kycData.documents?.idFront && kycData.documents?.idBack && kycData.documents?.proofOfAddress),
            data: {
              idFront: kycData.documents?.idFront || null,
              idBack: kycData.documents?.idBack || null,
              proofOfAddress: kycData.documents?.proofOfAddress || null
            }
          },
          {
            stepNumber: 6,
            stepName: 'Terms & Agreements',
            endpoint: '/api/v1/onboarding/agreements',
            completed: !!(user.terms_accepted && user.privacy_accepted),
            data: kycData.agreements || null
          },
          {
            stepNumber: 7,
            stepName: 'Submit Application',
            endpoint: '/api/v1/onboarding/submit-application',
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
            kyc: !!kycData.kyc,
            trustedContact: !!kycData.trustedContact,
            documents: !!(kycData.documents?.idFront && kycData.documents?.idBack && kycData.documents?.proofOfAddress),
            agreements: !!(user.terms_accepted && user.privacy_accepted),
            applicationSubmitted: user.registration_status === 'completed'
          }).filter(Boolean).length : 0,
          totalSteps: 7,
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

      // Check trusted contact
      if (!kycData.trustedContact) {
        missingSteps.push('Trusted contact not added');
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

          // Trusted contact
          trustedContact: {
            fullName: kycData.trustedContact.fullName,
            relationship: kycData.trustedContact.relationship,
            email: kycData.trustedContact.email,
            phoneNumber: kycData.trustedContact.phoneNumber,
            address: kycData.trustedContact.address
          },

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

        const alpacaAccount = await alpacaService.createAccount(alpacaAccountData);

        updates.alpaca_account_id = alpacaAccount.id;

        // Get initial status from Alpaca
        try {
          const alpacaStatus = await alpacaService.getAccountStatus(alpacaAccount.id);
          updates.kyc_status = alpacaStatus.kycStatus;
          logger.info(`Alpaca account status: ${alpacaStatus.status} -> KYC: ${alpacaStatus.kycStatus}`);
        } catch (statusError) {
          logger.warn('Could not get initial Alpaca status, defaulting to submitted:', statusError.message);
          updates.kyc_status = 'submitted';
        }

        alpacaAccountCreated = true;

        logger.info(`Alpaca account created successfully: ${alpacaAccount.id}`);

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

      // Add Alpaca account info if created successfully
      if (alpacaAccountCreated) {
        responseData.alpacaAccountId = updates.alpaca_account_id;
        responseData.tradingEnabled = true;
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

      const successMessage = alpacaAccountCreated ?
        'Onboarding completed successfully! Your trading account is ready.' :
        'Onboarding completed successfully! Your trading account is being set up.';

      return res.status(200).json(
        ApiResponse.SuccessWithData(responseData, successMessage)
      );

    } catch (error) {
      logger.error('Error completing onboarding:', error);
      return res.status(500).json(
        ApiResponse.Error('An error occurred while completing onboarding', 500)
      );
    }
  }
};

module.exports = onboardingController;