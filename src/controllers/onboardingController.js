const User = require('../models/User');
const { validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/onboarding');
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
    cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
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
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 2
  }
});

const profileImageUpload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG and PNG files are allowed.'), false);
    }
  },
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit
  }
});

const onboardingController = {
  // Get user profile and onboarding status
  getProfile: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ['password', 'pin_hash', 'login_attempts', 'lock_until'] }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Calculate onboarding progress
      const progress = {
        personalDetails: user.date_of_birth && user.gender && user.address ? 'complete' : 'incomplete',
        employerDetails: user.kyc_data?.employment ? 'complete' : 'incomplete',
        kyc: user.kyc_data?.kyc ? 'complete' : 'incomplete',
        trustedContact: user.kyc_data?.trustedContact ? 'complete' : 'incomplete',
        imageUpload: user.kyc_data?.profileImage ? 'complete' : 'incomplete',
        agreement: user.terms_accepted && user.privacy_accepted ? 'complete' : 'incomplete'
      };

      res.status(200).json({
        id: user.id,
        fullName: `${user.first_name} ${user.last_name}`,
        email: user.email,
        kycStatus: user.kyc_status,
        tradingEnabled: user.kyc_status === 'approved',
        onboardingComplete: user.registration_status === 'completed',
        alpacaAccountId: user.alpaca_account_id,
        onboardingProgress: progress
      });

    } catch (error) {
      console.error('Error fetching profile:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch profile',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Step 1: Personal Details
  personalDetails: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid data provided.',
          errors: errors.array().map(err => err.msg)
        });
      }

      const { dateOfBirth, gender, address } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update user with personal details
      await user.update({
        date_of_birth: new Date(dateOfBirth),
        gender: gender.toLowerCase(),
        address: JSON.stringify(address),
        city: address.city,
        postal_code: address.zipCode,
        registration_step: 'personal_info'
      });

      res.status(200).json({
        success: true,
        message: 'Personal details saved successfully.',
        data: {
          stepCompleted: 1,
          nextStep: 2
        }
      });

    } catch (error) {
      console.error('Error saving personal details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save personal details',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Step 2: Employment Details
  employmentDetails: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid employment data.',
          errors: errors.array().map(err => err.msg)
        });
      }

      const {
        employmentStatus,
        employerName,
        jobTitle,
        monthlyIncome,
        workAddress,
        yearsAtCurrentJob,
        // Self-employment specific fields
        businessName,
        businessType,
        businessDescription,
        businessAddress,
        yearsInBusiness,
        industryType
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Validate required fields based on employment status
      const validationErrors = [];

      if (!employmentStatus) {
        validationErrors.push('Employment status is required');
      }

      // Valid employment statuses
      const validStatuses = [
        'Employed', 'Self-Employed', 'Student', 'Unemployed', 'Retired',
        'Freelancer', 'Contract Worker', 'Part-Time', 'Homemaker',
        'Disabled', 'Other'
      ];

      if (!validStatuses.includes(employmentStatus)) {
        validationErrors.push(`Employment status must be one of: ${validStatuses.join(', ')}`);
      }

      // Income validation - required for most statuses except unemployed and some others
      const incomeNotRequired = ['Unemployed', 'Student', 'Homemaker', 'Disabled'];
      if (!incomeNotRequired.includes(employmentStatus)) {
        if (!monthlyIncome || monthlyIncome <= 0) {
          validationErrors.push('Monthly income is required for your employment status');
        }
      }

      // Profession/job title - always required except for unemployed
      if (employmentStatus !== 'Unemployed') {
        if (!jobTitle) {
          validationErrors.push('Profession/job title is required');
        }
      }

      // Employment status specific validations
      if (employmentStatus === 'Employed' || employmentStatus === 'Part-Time') {
        if (!employerName) {
          validationErrors.push('Employer name is required');
        }
        if (!yearsAtCurrentJob && yearsAtCurrentJob !== 0) {
          validationErrors.push('Years at current job is required');
        }
      }

      else if (employmentStatus === 'Self-Employed' || employmentStatus === 'Freelancer') {
        if (!businessName && !jobTitle) {
          validationErrors.push('Business name or professional title is required');
        }
        if (!businessType && !industryType) {
          validationErrors.push('Business type or industry is required');
        }
        if (!yearsInBusiness && yearsInBusiness !== 0) {
          validationErrors.push('Years in business/freelancing is required');
        }
      }

      else if (employmentStatus === 'Student') {
        // Students need educational info instead of employment
        if (!req.body.institution) {
          validationErrors.push('Educational institution is required for students');
        }
        if (!req.body.studyField) {
          validationErrors.push('Field of study is required for students');
        }
      }

      else if (employmentStatus === 'Retired') {
        // Retired individuals might have pension income
        if (!req.body.retirementYear) {
          validationErrors.push('Retirement year is required');
        }
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validationErrors
        });
      }

      // Prepare employment data based on employment status
      let employmentData = {
        status: employmentStatus,
        updatedAt: new Date()
      };

      // Common fields for all statuses
      if (jobTitle) employmentData.jobTitle = jobTitle;
      if (monthlyIncome) employmentData.monthlyIncome = monthlyIncome;

      // Employment-specific data
      switch (employmentStatus) {
        case 'Employed':
        case 'Part-Time':
          employmentData = {
            ...employmentData,
            employerName,
            jobTitle,
            monthlyIncome,
            workAddress,
            yearsAtCurrentJob,
            employmentType: 'traditional'
          };
          break;

        case 'Self-Employed':
        case 'Freelancer':
          employmentData = {
            ...employmentData,
            businessName: businessName || jobTitle,
            businessType: businessType || industryType,
            businessDescription,
            businessAddress: businessAddress || workAddress,
            profession: jobTitle,
            monthlyIncome,
            yearsInBusiness,
            industryType: industryType || businessType,
            employmentType: 'business'
          };
          break;

        case 'Contract Worker':
          employmentData = {
            ...employmentData,
            employerName: employerName || 'Various Clients',
            jobTitle,
            monthlyIncome,
            workAddress: workAddress || businessAddress,
            yearsAtCurrentJob: yearsAtCurrentJob || yearsInBusiness,
            contractType: req.body.contractType || 'Independent',
            employmentType: 'contract'
          };
          break;

        case 'Student':
          employmentData = {
            ...employmentData,
            institution: req.body.institution,
            studyField: req.body.studyField,
            yearOfStudy: req.body.yearOfStudy,
            graduationYear: req.body.graduationYear,
            partTimeWork: req.body.partTimeWork || false,
            monthlyIncome: monthlyIncome || 0, // Students might have allowances/part-time income
            employmentType: 'education'
          };
          break;

        case 'Retired':
          employmentData = {
            ...employmentData,
            retirementYear: req.body.retirementYear,
            previousOccupation: req.body.previousOccupation || jobTitle,
            pensionIncome: monthlyIncome,
            pensionProvider: req.body.pensionProvider,
            employmentType: 'retired'
          };
          break;

        case 'Unemployed':
          employmentData = {
            ...employmentData,
            unemploymentDuration: req.body.unemploymentDuration,
            previousOccupation: req.body.previousOccupation,
            seekingEmployment: req.body.seekingEmployment !== false, // Default true
            lastEmployer: req.body.lastEmployer,
            monthlyIncome: req.body.monthlyIncome || 0, // Might have benefits
            employmentType: 'unemployed'
          };
          break;

        case 'Homemaker':
          employmentData = {
            ...employmentData,
            dependentOn: req.body.dependentOn, // Spouse, family, etc.
            previousOccupation: req.body.previousOccupation,
            yearsAsHomemaker: req.body.yearsAsHomemaker,
            monthlyIncome: req.body.monthlyIncome || 0, // Might have allowances
            employmentType: 'homemaker'
          };
          break;

        case 'Disabled':
          employmentData = {
            ...employmentData,
            disabilityBenefits: req.body.disabilityBenefits,
            ableToWork: req.body.ableToWork || false,
            previousOccupation: req.body.previousOccupation,
            monthlyIncome: req.body.monthlyIncome || 0, // Disability benefits
            employmentType: 'disabled'
          };
          break;

        case 'Other':
          employmentData = {
            ...employmentData,
            description: req.body.description || 'Other employment status',
            jobTitle: jobTitle || 'Not specified',
            monthlyIncome: monthlyIncome || 0,
            additionalInfo: req.body.additionalInfo,
            employmentType: 'other'
          };
          break;

        default:
          employmentData.employmentType = 'unknown';
      }

      // Update kyc_data with employment information
      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        employment: employmentData
      };

      await user.update({
        occupation: jobTitle,
        kyc_data: updatedKycData
      });

      // Customize success message based on employment status
      const statusMessages = {
        'Employed': 'Employment details saved successfully.',
        'Self-Employed': 'Business details saved successfully.',
        'Student': 'Educational information saved successfully.',
        'Unemployed': 'Employment status information saved successfully.',
        'Retired': 'Retirement information saved successfully.',
        'Freelancer': 'Freelancer details saved successfully.',
        'Contract Worker': 'Contract work details saved successfully.',
        'Part-Time': 'Part-time employment details saved successfully.',
        'Homemaker': 'Homemaker information saved successfully.',
        'Disabled': 'Disability status information saved successfully.',
        'Other': 'Employment information saved successfully.'
      };

      const successMessage = statusMessages[employmentStatus] || 'Employment information saved successfully.';

      res.status(200).json({
        success: true,
        message: successMessage,
        data: {
          stepCompleted: 2,
          nextStep: 3,
          employmentStatus,
          employmentType: employmentData.employmentType
        }
      });

    } catch (error) {
      console.error('Error saving employment details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save employment details',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Step 3: KYC Information
  kycInformation: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid KYC data.',
          errors: errors.array().map(err => err.msg)
        });
      }

      const {
        idType,
        idNumber,
        idExpiryDate,
        nationality,
        placeOfBirth,
        purposeOfAccount,
        sourceOfFunds,
        expectedTransactionVolume
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update kyc_data with KYC information
      const currentKycData = user.kyc_data || {};
      const kycData = {
        ...currentKycData,
        kyc: {
          idType,
          idNumber,
          idExpiryDate,
          nationality,
          placeOfBirth,
          purposeOfAccount,
          sourceOfFunds,
          expectedTransactionVolume,
          updatedAt: new Date()
        }
      };

      await user.update({
        kyc_data: kycData,
        kyc_status: 'pending',
        citizenship: nationality.substring(0, 3).toUpperCase()
      });

      res.status(200).json({
        success: true,
        message: 'KYC information saved successfully.',
        data: {
          stepCompleted: 3,
          nextStep: 4,
          verificationRequired: true
        }
      });

    } catch (error) {
      console.error('Error saving KYC information:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save KYC information',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Step 4: Trusted Contact
  trustedContact: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid trusted contact information.',
          errors: errors.array().map(err => err.msg)
        });
      }

      const { fullName, relationship, email, phoneNumber, address } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update kyc_data with trusted contact information
      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        trustedContact: {
          fullName,
          relationship,
          email,
          phoneNumber,
          address,
          updatedAt: new Date()
        }
      };

      await user.update({
        kyc_data: updatedKycData
      });

      res.status(200).json({
        success: true,
        message: 'Trusted contact added successfully.',
        data: {
          stepCompleted: 4,
          nextStep: 5
        }
      });

    } catch (error) {
      console.error('Error saving trusted contact:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save trusted contact',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Step 5: Document Upload
  documentUploadMiddleware: upload.fields([
    { name: 'identityDocument', maxCount: 1 },
    { name: 'addressDocument', maxCount: 1 }
  ]),

  documentUpload: async (req, res) => {
    try {
      const { documentType } = req.body;
      const files = req.files;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!files || Object.keys(files).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'File upload failed.',
          errors: ['No files uploaded']
        });
      }

      const uploadedFiles = [];

      // Handle identity document
      if (files.identityDocument && files.identityDocument[0]) {
        const file = files.identityDocument[0];
        uploadedFiles.push({
          type: 'identity',
          fileName: file.originalname,
          status: 'uploaded',
          verificationStatus: 'pending'
        });
      }

      // Handle address document
      if (files.addressDocument && files.addressDocument[0]) {
        const file = files.addressDocument[0];
        uploadedFiles.push({
          type: 'address',
          fileName: file.originalname,
          status: 'uploaded',
          verificationStatus: 'pending'
        });
      }

      // Update kyc_data with document information
      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        documents: {
          uploadedFiles,
          uploadedAt: new Date()
        }
      };

      await user.update({
        kyc_data: updatedKycData,
        registration_status: 'documents_uploaded'
      });

      res.status(200).json({
        success: true,
        message: 'Documents uploaded successfully.',
        data: {
          stepCompleted: 5,
          nextStep: 6,
          uploadedFiles
        }
      });

    } catch (error) {
      console.error('Error uploading documents:', error);
      res.status(500).json({
        success: false,
        message: 'Document upload failed',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Step 6: Profile Image Upload
  profileImageUploadMiddleware: profileImageUpload.single('profileImage'),

  profileImageUpload: async (req, res) => {
    try {
      const file = req.file;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!file) {
        return res.status(400).json({
          success: false,
          message: 'Image upload failed.',
          errors: ['No image uploaded']
        });
      }

      // Update kyc_data with profile image information
      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        profileImage: {
          fileName: file.filename,
          originalName: file.originalname,
          path: file.path,
          uploadedAt: new Date()
        }
      };

      await user.update({
        kyc_data: updatedKycData
      });

      const imageUrl = `${req.protocol}://${req.get('host')}/uploads/onboarding/${file.filename}`;

      res.status(200).json({
        success: true,
        message: 'Profile image uploaded successfully.',
        data: {
          stepCompleted: 6,
          nextStep: 7,
          imageUrl
        }
      });

    } catch (error) {
      console.error('Error uploading profile image:', error);
      res.status(500).json({
        success: false,
        message: 'Profile image upload failed',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Step 7: Terms and Agreements
  agreements: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Required agreements not accepted.',
          errors: errors.array().map(err => err.msg)
        });
      }

      const {
        termsAndConditions,
        privacyPolicy,
        dataProcessingConsent,
        marketingConsent,
        agreementVersion,
        ipAddress,
        userAgent,
        timestamp
      } = req.body;

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update user agreements
      const currentKycData = user.kyc_data || {};
      const agreementData = {
        ...currentKycData,
        agreements: {
          termsAndConditions,
          privacyPolicy,
          dataProcessingConsent,
          marketingConsent,
          agreementVersion,
          ipAddress,
          userAgent,
          timestamp,
          acceptedAt: new Date()
        }
      };

      await user.update({
        terms_accepted: termsAndConditions,
        privacy_accepted: privacyPolicy,
        terms_accepted_at: new Date(),
        privacy_accepted_at: new Date(),
        kyc_data: agreementData
      });

      res.status(200).json({
        success: true,
        message: 'Agreements accepted successfully.',
        data: {
          stepCompleted: 7,
          nextStep: 8
        }
      });

    } catch (error) {
      console.error('Error saving agreements:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save agreements',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Step 8: Complete Onboarding
  completeOnboarding: async (req, res) => {
    try {
      const { confirmCompletion } = req.body;

      if (!confirmCompletion) {
        return res.status(400).json({
          success: false,
          message: 'Cannot complete onboarding.',
          errors: ['Completion confirmation required']
        });
      }

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
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
        return res.status(400).json({
          success: false,
          message: 'Cannot complete onboarding.',
          errors: missingSteps
        });
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

        console.log('Creating Alpaca account with data:', JSON.stringify(alpacaAccountData, null, 2));

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

        console.log(`Alpaca account created successfully: ${alpacaAccount.id}`);

      } catch (error) {
        console.error('Error creating Alpaca account:', error);
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
        console.warn('Failed to send onboarding completion email:', emailError);
      }

      res.status(200).json({
        success: true,
        message: alpacaAccountCreated ?
          'Onboarding completed successfully! Your trading account is ready.' :
          'Onboarding completed successfully! Your trading account is being set up.',
        data: responseData
      });

    } catch (error) {
      console.error('Error completing onboarding:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete onboarding',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Get Onboarding Progress
  getProgress: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Calculate progress
      const steps = {
        personalDetails: user.date_of_birth && user.gender && user.address ? 'complete' : 'incomplete',
        employerDetails: user.kyc_data?.employment ? 'complete' : 'incomplete',
        kyc: user.kyc_data?.kyc ? 'complete' : 'incomplete',
        trustedContact: user.kyc_data?.trustedContact ? 'complete' : 'incomplete',
        documentUpload: user.kyc_data?.documents ? 'complete' : 'incomplete',
        imageUpload: user.kyc_data?.profileImage ? 'complete' : 'incomplete',
        agreement: user.terms_accepted && user.privacy_accepted ? 'complete' : 'incomplete',
        completion: user.registration_status === 'completed' ? 'complete' : 'incomplete'
      };

      const completedSteps = Object.keys(steps).filter(step => steps[step] === 'complete');
      const totalSteps = 8;
      const currentStep = completedSteps.length + 1;

      // Determine next step
      const stepMapping = [
        { stepNumber: 1, stepName: 'Personal Details', endpoint: '/api/onboarding/personal-details', key: 'personalDetails' },
        { stepNumber: 2, stepName: 'Employment Details', endpoint: '/api/onboarding/employer-details', key: 'employerDetails' },
        { stepNumber: 3, stepName: 'KYC Verification', endpoint: '/api/onboarding/kyc', key: 'kyc' },
        { stepNumber: 4, stepName: 'Trusted Contact', endpoint: '/api/onboarding/trusted-contact', key: 'trustedContact' },
        { stepNumber: 5, stepName: 'Document Upload', endpoint: '/api/onboarding/document-upload', key: 'documentUpload' },
        { stepNumber: 6, stepName: 'Profile Image', endpoint: '/api/onboarding/profile-image', key: 'imageUpload' },
        { stepNumber: 7, stepName: 'Terms & Agreements', endpoint: '/api/onboarding/agreements', key: 'agreement' },
        { stepNumber: 8, stepName: 'Complete Onboarding', endpoint: '/api/onboarding/complete', key: 'completion' }
      ];

      const nextStepInfo = stepMapping.find(step => steps[step.key] === 'incomplete') || null;

      res.status(200).json({
        success: true,
        data: {
          currentStep: Math.min(currentStep, totalSteps),
          totalSteps,
          completedSteps: completedSteps.map((_, index) => index + 1),
          nextStep: nextStepInfo ? {
            stepNumber: nextStepInfo.stepNumber,
            stepName: nextStepInfo.stepName,
            endpoint: nextStepInfo.endpoint,
            required: true
          } : null,
          onboardingComplete: user.registration_status === 'completed',
          progress: steps
        }
      });

    } catch (error) {
      console.error('Error fetching onboarding progress:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch progress',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
};

module.exports = onboardingController;