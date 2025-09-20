const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, EmailVerificationToken, PhoneVerificationToken } = require('../models');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');
const smsService = require('../services/smsService');
const logger = require('../utils/logger');

// Simple in-memory storage for registration data (use Redis in production)
const registrationData = new Map();

const generateRegistrationId = () => {
  return crypto.randomBytes(16).toString('hex');
};

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Start registration - creates registration session
const startRegistration = async (req, res) => {
  try {
    const registrationId = generateRegistrationId();

    registrationData.set(registrationId, {
      step: 'started',
      data: {},
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
    });

    res.status(200).json({
      success: true,
      message: 'Registration session started',
      registrationId,
      currentStep: 'citizenship'
    });

  } catch (error) {
    logger.error('Start registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 1: Save Citizenship
const saveCitizenship = async (req, res) => {
  try {
    const { registrationId, citizenship } = req.body;

    if (!registrationId || !citizenship) {
      return res.status(400).json({
        success: false,
        message: 'Registration ID and citizenship are required'
      });
    }

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    regData.data.citizenship = citizenship;
    regData.step = 'citizenship';
    registrationData.set(registrationId, regData);

    res.status(200).json({
      success: true,
      message: 'Citizenship saved',
      nextStep: 'email'
    });

  } catch (error) {
    logger.error('Save citizenship error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 2: Save Email
const saveEmail = async (req, res) => {
  try {
    const { registrationId, email } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    regData.data.email = email;
    regData.step = 'email';
    registrationData.set(registrationId, regData);

    res.status(200).json({
      success: true,
      message: 'Email saved',
      nextStep: 'password'
    });

  } catch (error) {
    logger.error('Save email error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 3: Save Password and Send Email Verification
const savePasswordAndSendVerification = async (req, res) => {
  try {
    const { registrationId, password } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    regData.data.password = password;
    regData.step = 'password';

    // Generate and send email verification
    const verificationCode = generateVerificationCode();
    regData.data.emailVerificationCode = verificationCode;
    regData.data.emailVerificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    registrationData.set(registrationId, regData);

    // Send email verification
    const emailResult = await emailService.sendVerificationCodeEmail(
      { email: regData.data.email, first_name: 'User' },
      verificationCode
    );

    res.status(200).json({
      success: true,
      message: 'Password saved and verification code sent',
      emailSent: emailResult.success,
      nextStep: 'verify_email'
    });

  } catch (error) {
    logger.error('Save password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 4: Verify Email
const verifyEmail = async (req, res) => {
  try {
    const { registrationId, verificationCode } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    if (new Date() > regData.data.emailVerificationExpires) {
      return res.status(400).json({
        success: false,
        message: 'Verification code expired'
      });
    }

    if (regData.data.emailVerificationCode !== verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    regData.data.emailVerified = true;
    regData.data.phoneVerified = true; // Auto-verify phone for now (temporary)
    regData.step = 'email_verified';
    registrationData.set(registrationId, regData);

    res.status(200).json({
      success: true,
      message: 'Email and phone verified successfully',
      nextStep: 'personal_info',
      note: 'Phone auto-verified temporarily until SMS credentials are configured'
    });

  } catch (error) {
    logger.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 5: Save Personal Info (Name, Gender, DOB)
const savePersonalInfo = async (req, res) => {
  try {
    const { registrationId, firstName, lastName, gender, dateOfBirth } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    regData.data.firstName = firstName;
    regData.data.lastName = lastName;
    regData.data.gender = gender;
    regData.data.dateOfBirth = dateOfBirth;
    regData.step = 'personal_info';
    registrationData.set(registrationId, regData);

    res.status(200).json({
      success: true,
      message: 'Personal information saved',
      nextStep: 'phone'
    });

  } catch (error) {
    logger.error('Save personal info error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 6: Save Phone and Send SMS Verification
const savePhoneAndSendSMS = async (req, res) => {
  try {
    const { registrationId, phone } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    // Check if phone already exists
    const existingUser = await User.findOne({ where: { phone } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already registered'
      });
    }

    const verificationCode = generateVerificationCode();
    regData.data.phone = phone;
    regData.data.phoneVerificationCode = verificationCode;
    regData.data.phoneVerificationExpires = new Date(Date.now() + 15 * 60 * 1000);
    regData.step = 'phone';

    registrationData.set(registrationId, regData);

    // Send SMS verification
    const smsResult = await smsService.sendVerificationCode(
      phone,
      verificationCode,
      regData.data.firstName || 'User'
    );

    res.status(200).json({
      success: true,
      message: 'Phone saved and verification code sent',
      smsSent: smsResult.success,
      nextStep: 'verify_phone'
    });

  } catch (error) {
    logger.error('Save phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 7: Verify Phone
const verifyPhone = async (req, res) => {
  try {
    const { registrationId, verificationCode } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    // Check if phone is already verified (from email verification)
    if (regData.data.phoneVerified) {
      return res.status(200).json({
        success: true,
        message: 'Phone already verified',
        nextStep: 'address',
        note: 'Phone was auto-verified during email verification'
      });
    }

    if (new Date() > regData.data.phoneVerificationExpires) {
      return res.status(400).json({
        success: false,
        message: 'Verification code expired'
      });
    }

    if (regData.data.phoneVerificationCode !== verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    regData.data.phoneVerified = true;
    regData.step = 'phone_verified';
    registrationData.set(registrationId, regData);

    res.status(200).json({
      success: true,
      message: 'Phone verified successfully',
      nextStep: 'address'
    });

  } catch (error) {
    logger.error('Verify phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 8: Save Address
const saveAddress = async (req, res) => {
  try {
    const { registrationId, address, city, state, zipCode } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    regData.data.address = address;
    regData.data.city = city;
    regData.data.state = state;
    regData.data.zipCode = zipCode;
    regData.step = 'address';
    registrationData.set(registrationId, regData);

    res.status(200).json({
      success: true,
      message: 'Address saved',
      nextStep: 'quiz'
    });

  } catch (error) {
    logger.error('Save address error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 9: Save Quiz Answers
const saveQuizAnswers = async (req, res) => {
  try {
    const { registrationId, answers } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    regData.data.quizAnswers = answers;
    regData.step = 'quiz';
    registrationData.set(registrationId, regData);

    res.status(200).json({
      success: true,
      message: 'Quiz answers saved',
      nextStep: 'documents'
    });

  } catch (error) {
    logger.error('Save quiz error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 10: Upload Documents
const uploadDocuments = async (req, res) => {
  try {
    const { registrationId } = req.body;
    const file = req.file;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'Document file is required'
      });
    }

    regData.data.proofOfAddress = {
      filename: file.filename,
      originalName: file.originalname,
      uploadedAt: new Date()
    };
    regData.step = 'documents';
    registrationData.set(registrationId, regData);

    res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      nextStep: 'complete'
    });

  } catch (error) {
    logger.error('Upload documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Step 11: Complete Registration
const completeRegistration = async (req, res) => {
  try {
    const { registrationId, termsAccepted, privacyAccepted } = req.body;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    if (!termsAccepted || !privacyAccepted) {
      return res.status(400).json({
        success: false,
        message: 'Terms and privacy policy must be accepted'
      });
    }

    // Create user account
    const userData = regData.data;
    const user = await User.create({
      first_name: userData.firstName,
      last_name: userData.lastName,
      email: userData.email,
      phone: userData.phone,
      password: userData.password,
      citizenship: userData.citizenship,
      gender: userData.gender,
      date_of_birth: userData.dateOfBirth,
      address: userData.address,
      city: userData.city,
      county: userData.state,
      postal_code: userData.zipCode,
      registration_step: 'completed',
      kyc_status: 'pending',
      account_status: 'pending',
      is_email_verified: true,
      is_phone_verified: true,
      kyc_data: {
        quizAnswers: userData.quizAnswers,
        proofOfAddress: userData.proofOfAddress
      }
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Send welcome notification
    try {
      await notificationService.sendRegistrationWelcome(user.id, user.first_name);
    } catch (notificationError) {
      logger.error('Welcome notification failed:', notificationError);
    }

    // Clean up registration data
    registrationData.delete(registrationId);

    logger.info(`User registration completed: ${userData.email}`);

    res.status(201).json({
      success: true,
      message: 'Registration completed successfully!',
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        registrationStep: user.registration_step,
        kycStatus: user.kyc_status,
        accountStatus: user.account_status
      }
    });

  } catch (error) {
    logger.error('Complete registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get current registration step
const getCurrentStep = async (req, res) => {
  try {
    const { registrationId } = req.params;

    const regData = registrationData.get(registrationId);
    if (!regData || new Date() > regData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired registration session'
      });
    }

    res.status(200).json({
      success: true,
      currentStep: regData.step,
      data: {
        citizenship: regData.data.citizenship,
        email: regData.data.email,
        firstName: regData.data.firstName,
        lastName: regData.data.lastName,
        gender: regData.data.gender,
        dateOfBirth: regData.data.dateOfBirth,
        phone: regData.data.phone,
        address: regData.data.address,
        emailVerified: regData.data.emailVerified || false,
        phoneVerified: regData.data.phoneVerified || false
      }
    });

  } catch (error) {
    logger.error('Get current step error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Complete registration with full payload (Alternative endpoint)
const registerUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      citizenship,
      gender,
      dateOfBirth,
      address,
      city,
      state,
      zipCode,
      termsAccepted,
      privacyAccepted
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided',
        required: ['firstName', 'lastName', 'email', 'password', 'phone']
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      where: {
        [User.sequelize.Sequelize.Op.or]: [
          { email },
          { phone }
        ]
      }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: existingUser.email === email ? 'Email already registered' : 'Phone number already registered'
      });
    }

    // Validate age (must be 18+)
    if (dateOfBirth) {
      const age = new Date().getFullYear() - new Date(dateOfBirth).getFullYear();
      if (age < 18) {
        return res.status(400).json({
          success: false,
          message: 'Must be 18 years or older'
        });
      }
    }

    // Check terms acceptance
    if (!termsAccepted || !privacyAccepted) {
      return res.status(400).json({
        success: false,
        message: 'Terms and privacy policy must be accepted'
      });
    }

    // Create user account
    const user = await User.create({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      password,
      citizenship: citizenship || 'US',
      gender: gender || 'not_specified',
      date_of_birth: dateOfBirth,
      address,
      city,
      county: state,
      postal_code: zipCode,
      registration_step: 'initial_completed',
      kyc_status: 'pending',
      account_status: 'pending',
      is_email_verified: true,  // Auto-verified temporarily
      is_phone_verified: true,  // Auto-verified temporarily
      terms_accepted: true,
      privacy_accepted: true,
      terms_accepted_at: new Date(),
      privacy_accepted_at: new Date(),
      registration_status: 'started',
      kyc_data: {}
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Send verification codes
    try {
      const emailVerificationCode = generateVerificationCode();
      const phoneVerificationCode = generateVerificationCode();

      // Store verification codes in database
      await EmailVerificationToken.create({
        user_id: user.id,
        token: emailVerificationCode,
        expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      });

      await PhoneVerificationToken.create({
        user_id: user.id,
        token: phoneVerificationCode,
        expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      });

      // Send email verification
      await emailService.sendVerificationCodeEmail(
        { email: user.email, first_name: user.first_name },
        emailVerificationCode
      );

      // Send SMS verification
      await smsService.sendVerificationCode(
        phone,
        phoneVerificationCode,
        firstName
      );

    } catch (verificationError) {
      logger.error('Verification codes sending failed:', verificationError);
    }

    // Send welcome notification
    try {
      await notificationService.sendRegistrationWelcome(user.id, user.first_name);
    } catch (notificationError) {
      logger.error('Welcome notification failed:', notificationError);
    }

    logger.info(`User registered successfully: ${email}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully! Please verify your email and phone.',
      data: {
        registrationId: user.id,
        token,
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          phone: user.phone,
          citizenship: user.citizenship,
          registrationStep: user.registration_step,
          kycStatus: user.kyc_status,
          accountStatus: user.account_status,
          isEmailVerified: user.is_email_verified,
          isPhoneVerified: user.is_phone_verified
        },
        nextSteps: [
          'verify_email',
          'verify_phone',
          'complete_quiz',
          'upload_documents'
        ]
      }
    });

  } catch (error) {
    logger.error('User registration error:', error);

    // Handle unique constraint violations
    if (error.name === 'SequelizeUniqueConstraintError') {
      const field = error.errors[0]?.path;
      return res.status(409).json({
        success: false,
        message: `${field === 'email' ? 'Email' : 'Phone number'} already registered`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  startRegistration,
  saveCitizenship,
  saveEmail,
  savePasswordAndSendVerification,
  verifyEmail,
  savePersonalInfo,
  savePhoneAndSendSMS,
  verifyPhone,
  saveAddress,
  saveQuizAnswers,
  uploadDocuments,
  completeRegistration,
  getCurrentStep,
  registerUser
};