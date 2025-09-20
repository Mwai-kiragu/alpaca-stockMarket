const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Wallet, EmailVerificationToken, PhoneVerificationToken } = require('../models');
const emailService = require('../services/emailService');
const alpacaService = require('../services/alpacaService');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const register = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, citizenship, gender, dateOfBirth } = req.body;

    const existingUser = await User.findOne({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const user = await User.create({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      password,
      citizenship: citizenship || 'KE',
      gender: gender,
      date_of_birth: dateOfBirth,
      registration_step: 'email_verification',
      kyc_status: 'not_started'
    });

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const verificationToken = EmailVerificationToken.generateToken();

    await EmailVerificationToken.create({
      user_id: user.id,
      token: verificationToken,
      verification_code: verificationCode,
      expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });

    // Send verification email with code
    const emailResult = await emailService.sendVerificationCodeEmail(user, verificationCode);

    if (!emailResult.success) {
      logger.error(`Failed to send verification email to ${email}:`, emailResult.error);
      // Continue with registration but notify user
    }

    const token = generateToken(user.id);

    // Send welcome notification (push + SMS)
    try {
      await notificationService.sendRegistrationWelcome(user.id, user.first_name);
    } catch (notificationError) {
      logger.error('Failed to send welcome notification:', notificationError);
      // Don't fail registration if notification fails
    }

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email for the verification code.',
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
        isEmailVerified: user.is_email_verified,
        isPhoneVerified: user.is_phone_verified
      },
      nextStep: 'verify_email',
      emailSent: emailResult.success
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      where: { email },
      include: [{ model: Wallet, as: 'wallet' }]
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to too many failed login attempts'
      });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      await user.incLoginAttempts();
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Reset login attempts on successful login
    if (user.login_attempts > 0) {
      await user.update({
        login_attempts: 0,
        lock_until: null
      });
    }

    user.last_login = new Date();
    await user.save();

    const token = generateToken(user.id);

    // Determine next step based on registration progress
    let nextStep = 'dashboard';
    let redirectTo = '/dashboard';

    switch (user.registration_step) {
      case 'email_verification':
        nextStep = 'verify_email';
        redirectTo = '/verify-email';
        break;
      case 'personal_info':
        nextStep = 'complete_profile';
        redirectTo = '/complete-profile';
        break;
      case 'phone_verification':
        nextStep = 'verify_phone';
        redirectTo = '/verify-phone';
        break;
      case 'address_info':
        nextStep = 'address_information';
        redirectTo = '/address-information';
        break;
      case 'kyc_verification':
        nextStep = 'kyc_documents';
        redirectTo = '/kyc-documents';
        break;
      case 'kyc_pending':
      case 'kyc_under_review':
        nextStep = 'await_approval';
        redirectTo = '/account-under-review';
        break;
      case 'completed':
        if (user.kyc_status === 'approved' && user.alpaca_account_id) {
          nextStep = 'dashboard';
          redirectTo = '/dashboard';
        } else {
          nextStep = 'await_approval';
          redirectTo = '/account-under-review';
        }
        break;
    }

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        kycStatus: user.kyc_status,
        accountStatus: user.account_status,
        registrationStep: user.registration_step,
        isEmailVerified: user.is_email_verified,
        isPhoneVerified: user.is_phone_verified,
        alpacaAccountId: user.alpaca_account_id,
        role: user.role,
        wallet: user.wallet ? {
          kesBalance: user.wallet.kes_balance,
          usdBalance: user.wallet.usd_balance,
          availableKes: user.wallet.kes_balance - user.wallet.frozen_kes,
          availableUsd: user.wallet.usd_balance - user.wallet.frozen_usd
        } : null
      },
      nextStep,
      redirectTo
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Wallet, as: 'wallet' }]
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        kycStatus: user.kyc_status,
        isEmailVerified: user.is_email_verified,
        isPhoneVerified: user.is_phone_verified,
        role: user.role,
        wallet: {
          kesBalance: user.wallet?.kes_balance || 0,
          usdBalance: user.wallet?.usd_balance || 0,
          availableKes: user.wallet?.availableKes || 0,
          availableUsd: user.wallet?.availableUsd || 0
        }
      }
    });
  } catch (error) {
    logger.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      address,
      city,
      county,
      postalCode,
      occupation,
      // KYC fields
      idType,
      idNumber,
      proofOfAddress,
      idDocumentFront,
      idDocumentBack,
      selfie
    } = req.body;

    const user = await User.findByPk(req.user.id);

    // Basic profile updates
    const updates = {};
    if (firstName) updates.first_name = firstName;
    if (lastName) updates.last_name = lastName;
    if (dateOfBirth) updates.date_of_birth = dateOfBirth;
    if (gender) updates.gender = gender;
    if (address) updates.address = address;
    if (city) updates.city = city;
    if (county) updates.county = county;
    if (postalCode) updates.postal_code = postalCode;

    // Handle phone update
    if (phone && phone !== user.phone) {
      const phoneExists = await User.findOne({
        where: {
          phone,
          id: { [User.sequelize.Sequelize.Op.ne]: user.id }
        }
      });

      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use'
        });
      }

      updates.phone = phone;
      updates.is_phone_verified = false;
    }

    // Handle KYC update if documents provided
    if (idType || idNumber || proofOfAddress || idDocumentFront) {
      const currentKycData = user.kyc_data || {};

      updates.kyc_data = {
        ...currentKycData,
        ...(idType && { idType }),
        ...(idNumber && { idNumber }),
        ...(occupation && { occupation }),
        documents: {
          ...currentKycData.documents,
          ...(proofOfAddress && { proofOfAddress }),
          ...(idDocumentFront && { idDocumentFront }),
          ...(idDocumentBack && { idDocumentBack }),
          ...(selfie && { selfie })
        },
        updatedAt: new Date()
      };

      // If KYC was previously rejected or not started, reset to pending
      if (['rejected', 'not_started'].includes(user.kyc_status)) {
        updates.kyc_status = 'pending';

        // Try to create/update Alpaca account
        try {
          const alpacaAccountData = {
            firstName: firstName || user.first_name,
            lastName: lastName || user.last_name,
            email: user.email,
            phone: phone || user.phone,
            dateOfBirth: dateOfBirth || user.date_of_birth,
            address: address || user.address,
            city: city || user.city,
            postalCode: postalCode || user.postal_code,
            idNumber: idNumber || currentKycData.idNumber,
            idType: idType || currentKycData.idType,
            occupation: occupation || currentKycData.occupation
          };

          if (user.alpaca_account_id) {
            // In production, you'd update the existing account
            logger.info('Would update existing Alpaca account:', user.alpaca_account_id);
          } else {
            // Create new Alpaca account
            const alpacaAccount = await alpacaService.createAccount(alpacaAccountData);
            updates.alpaca_account_id = alpacaAccount.id;
            logger.info('Created new Alpaca account:', alpacaAccount.id);
          }

          updates.kyc_status = 'approved';
          updates.account_status = 'active';
          updates.registration_step = 'completed';

          // Send approval email
          setTimeout(async () => {
            try {
              await emailService.sendKYCApprovalEmail(user);
            } catch (emailError) {
              logger.warn('Failed to send KYC approval email:', emailError);
            }
          }, 1000);

        } catch (alpacaError) {
          logger.error('Alpaca account creation/update failed:', alpacaError);
          updates.kyc_status = 'under_review';
          updates.registration_step = 'kyc_under_review';
        }
      }
    }

    await user.update(updates);

    logger.info(`User profile updated: ${user.email}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        dateOfBirth: user.date_of_birth,
        gender: user.gender,
        address: user.address,
        city: user.city,
        county: user.county,
        postalCode: user.postal_code,
        kycStatus: user.kyc_status,
        accountStatus: user.account_status,
        registrationStep: user.registration_step,
        isEmailVerified: user.is_email_verified,
        isPhoneVerified: user.is_phone_verified,
        alpacaAccountId: user.alpaca_account_id
      }
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during profile update'
    });
  }
};

const submitKYC = async (req, res) => {
  try {
    const { idNumber, idType, dateOfBirth, address, occupation } = req.body;

    const user = await User.findById(req.user.id);

    if (user.kycStatus === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'KYC already approved'
      });
    }

    user.kycData = {
      idNumber,
      idType,
      dateOfBirth: new Date(dateOfBirth),
      address,
      occupation
    };
    user.kycStatus = 'submitted';

    await user.save();

    logger.info(`KYC submitted by user: ${user.email}`);

    res.json({
      success: true,
      message: 'KYC information submitted successfully. Under review.',
      kycStatus: user.kycStatus
    });
  } catch (error) {
    logger.error('KYC submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during KYC submission'
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    user.password = newPassword;
    await user.save();

    logger.info(`Password changed for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');

    logger.info(`Password reset requested for user: ${email}`);

    res.json({
      success: true,
      message: 'Password reset instructions sent to your email',
      resetToken
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    const verificationToken = await EmailVerificationToken.findOne({
      where: {
        token,
        used: false
      },
      include: [{ model: User, as: 'user' }]
    });

    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    if (verificationToken.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Verification token has expired'
      });
    }

    // Mark user as verified
    await verificationToken.user.update({
      is_email_verified: true
    });

    // Mark token as used
    await verificationToken.update({ used: true });

    logger.info(`Email verified for user: ${verificationToken.user.email}`);

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    logger.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during email verification'
    });
  }
};

const verifyEmailCode = async (req, res) => {
  try {
    const { code, email } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required'
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find the user by email first
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }

    const verificationToken = await EmailVerificationToken.findOne({
      where: {
        user_id: user.id,
        verification_code: code,
        used: false
      },
      include: [{ model: User, as: 'user' }]
    });

    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    if (verificationToken.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired'
      });
    }

    // Mark user as email verified and move to next step
    await verificationToken.user.update({
      is_email_verified: true,
      registration_step: 'personal_info'
    });

    // Mark token as used
    await verificationToken.update({ used: true });

    logger.info(`Email verified with code for user: ${verificationToken.user.email}`);

    // Generate a token for the user so they can proceed with the next steps
    const token = generateToken(user.id);

    res.json({
      success: true,
      message: 'Email verified successfully',
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        registrationStep: 'personal_info',
        isEmailVerified: true,
        isPhoneVerified: user.is_phone_verified
      },
      nextStep: 'complete_profile',
      redirectTo: '/complete-profile'
    });
  } catch (error) {
    logger.error('Email code verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during email verification'
    });
  }
};

const completeProfile = async (req, res) => {
  try {
    const { dateOfBirth, gender, occupation } = req.body;

    const user = await User.findByPk(req.user.id);

    if (user.registration_step !== 'personal_info') {
      return res.status(400).json({
        success: false,
        message: 'Invalid registration step'
      });
    }

    await user.update({
      date_of_birth: dateOfBirth,
      gender,
      occupation,
      registration_step: 'phone_verification'
    });

    // Generate phone verification code
    const phoneCode = generateVerificationCode();

    await PhoneVerificationToken.create({
      user_id: user.id,
      verification_code: phoneCode,
      expires_at: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // In production, send SMS with phone verification code
    logger.info(`Phone verification code generated for ${user.phone}: ${phoneCode}`);

    res.json({
      success: true,
      message: 'Profile completed successfully. Phone verification code sent.',
      nextStep: 'verify_phone',
      redirectTo: '/verify-phone',
      // Remove this in production - only for testing
      phoneCode: process.env.NODE_ENV === 'development' ? phoneCode : undefined
    });
  } catch (error) {
    logger.error('Complete profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during profile completion'
    });
  }
};

const verifyPhoneCode = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required'
      });
    }

    const verificationToken = await PhoneVerificationToken.findOne({
      where: {
        user_id: req.user.id,
        verification_code: code,
        used: false
      }
    });

    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    if (verificationToken.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired'
      });
    }

    const user = await User.findByPk(req.user.id);

    // Mark user as phone verified and move to next step
    await user.update({
      is_phone_verified: true,
      registration_step: 'address_info'
    });

    // Mark token as used
    await verificationToken.update({ used: true });

    logger.info(`Phone verified for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Phone verified successfully',
      nextStep: 'address_information',
      redirectTo: '/address-information'
    });
  } catch (error) {
    logger.error('Phone verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during phone verification'
    });
  }
};

const completeAddress = async (req, res) => {
  try {
    const { address, city, county, postalCode } = req.body;

    const user = await User.findByPk(req.user.id);

    if (user.registration_step !== 'address_info') {
      return res.status(400).json({
        success: false,
        message: 'Invalid registration step'
      });
    }

    await user.update({
      address,
      city,
      county,
      postal_code: postalCode,
      registration_step: 'kyc_verification'
    });

    logger.info(`Address completed for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Address information saved successfully',
      nextStep: 'kyc_documents',
      redirectTo: '/kyc-documents'
    });
  } catch (error) {
    logger.error('Complete address error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during address completion'
    });
  }
};

const submitKYCDocuments = async (req, res) => {
  try {
    const {
      idType,
      idNumber,
      proofOfAddress,
      idDocumentFront,
      idDocumentBack,
      selfie
    } = req.body;

    const user = await User.findByPk(req.user.id);

    if (user.registration_step !== 'kyc_verification') {
      return res.status(400).json({
        success: false,
        message: 'Invalid registration step'
      });
    }

    const kycData = {
      idType,
      idNumber,
      documents: {
        proofOfAddress,
        idDocumentFront,
        idDocumentBack,
        selfie
      },
      submittedAt: new Date()
    };

    let updates = {
      kyc_data: kycData,
      kyc_status: 'pending',
      registration_step: 'kyc_pending'
    };

    // Try to create Alpaca account
    try {
      const alpacaAccountData = {
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        dateOfBirth: user.date_of_birth,
        address: user.address,
        city: user.city,
        postalCode: user.postal_code,
        idNumber,
        idType,
        occupation: user.occupation
      };

      const alpacaAccount = await alpacaService.createAccount(alpacaAccountData);
      updates.alpaca_account_id = alpacaAccount.id;
      updates.kyc_status = 'approved';
      updates.account_status = 'active';
      updates.registration_step = 'completed';

      logger.info(`KYC approved and Alpaca account created for user: ${user.email}`);

      // Send approval email
      setTimeout(async () => {
        try {
          await emailService.sendKYCApprovalEmail(user);
        } catch (emailError) {
          logger.warn('Failed to send KYC approval email:', emailError);
        }
      }, 1000);

    } catch (alpacaError) {
      logger.error('Alpaca account creation failed:', alpacaError);
      updates.kyc_status = 'under_review';
      updates.registration_step = 'kyc_under_review';
    }

    await user.update(updates);

    const isApproved = updates.kyc_status === 'approved';

    res.json({
      success: true,
      message: isApproved ?
        'KYC documents approved! Your account is ready for trading.' :
        'KYC documents submitted successfully. Under review.',
      kycStatus: updates.kyc_status,
      accountStatus: updates.account_status,
      registrationStep: updates.registration_step,
      nextStep: isApproved ? 'dashboard' : 'await_approval',
      redirectTo: isApproved ? '/dashboard' : '/account-under-review'
    });
  } catch (error) {
    logger.error('KYC documents submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during KYC submission'
    });
  }
};

const resendVerificationEmail = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (user.is_email_verified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Invalidate old tokens
    await EmailVerificationToken.update(
      { used: true },
      { where: { user_id: user.id, used: false } }
    );

    // Generate new verification code
    const verificationCode = generateVerificationCode();
    const verificationToken = EmailVerificationToken.generateToken();

    await EmailVerificationToken.create({
      user_id: user.id,
      token: verificationToken,
      verification_code: verificationCode,
      expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });

    // Send verification email with code
    const emailResult = await emailService.sendVerificationCodeEmail(user, verificationCode);

    if (emailResult.success) {
      res.json({
        success: true,
        message: 'Verification email sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send verification email'
      });
    }
  } catch (error) {
    logger.error('Resend verification email error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const resendPhoneCode = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (user.is_phone_verified) {
      return res.status(400).json({
        success: false,
        message: 'Phone is already verified'
      });
    }

    // Invalidate old tokens
    await PhoneVerificationToken.update(
      { used: true },
      { where: { user_id: user.id, used: false } }
    );

    // Generate new phone verification code
    const phoneCode = generateVerificationCode();

    await PhoneVerificationToken.create({
      user_id: user.id,
      verification_code: phoneCode,
      expires_at: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // In production, send SMS with phone verification code
    logger.info(`Phone verification code resent for ${user.phone}: ${phoneCode}`);

    res.json({
      success: true,
      message: 'Phone verification code resent successfully',
      // Remove this in production - only for testing
      phoneCode: process.env.NODE_ENV === 'development' ? phoneCode : undefined
    });
  } catch (error) {
    logger.error('Resend phone code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  submitKYC,
  changePassword,
  forgotPassword,
  verifyEmail,
  verifyEmailCode,
  completeProfile,
  verifyPhoneCode,
  completeAddress,
  submitKYCDocuments,
  resendVerificationEmail,
  resendPhoneCode
};