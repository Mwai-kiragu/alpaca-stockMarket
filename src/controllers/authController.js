const jwt = require('jsonwebtoken');
const { User, EmailVerificationToken, PhoneVerificationToken } = require('../models');
const emailService = require('../services/emailService');
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

// Registration - Step 1 of onboarding process
const register = async (req, res) => {
  try {
    const { fullName, email, password, phoneNumber } = req.body;

    // Check for existing email
    const existingUser = await User.findOne({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists.'
      });
    }

    // Split full name into first and last name
    const nameParts = fullName.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const user = await User.create({
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phoneNumber,
      password,
      registration_step: 'email_verification',
      kyc_status: 'not_started',
      registration_status: 'started'
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
    // const emailResult = await emailService.sendVerificationCodeEmail(user, verificationCode);

    // if (!emailResult.success) {
    //   logger.error(`Failed to send verification email to ${email}:`, emailResult.error);
    // }

    // Send welcome notification
    try {
      await notificationService.sendRegistrationWelcome(user.id, user.first_name);
    } catch (notificationError) {
      logger.error('Failed to send welcome notification:', notificationError);
    }

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.'
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.'
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
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.'
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

    // Determine onboarding status
    const requiresVerification = !user.is_email_verified || !user.is_phone_verified;
    const onboardingComplete = user.registration_status === 'completed';

    logger.info(`User logged in: ${email}`);

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        fullName: `${user.first_name} ${user.last_name}`,
        email: user.email,
        requiresVerification,
        onboardingComplete
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// Request verification code
const requestVerification = async (req, res) => {
  try {
    const { verificationType } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (verificationType === 'email') {
      if (user.is_email_verified) {
        return res.status(400).json({
          success: false,
          message: 'Email is already verified'
        });
      }

      // Generate new verification code
      const verificationCode = generateVerificationCode();
      const verificationToken = EmailVerificationToken.generateToken();

      // Invalidate old tokens
      await EmailVerificationToken.update(
        { used: true },
        { where: { user_id: user.id, used: false } }
      );

      await EmailVerificationToken.create({
        user_id: user.id,
        token: verificationToken,
        verification_code: verificationCode,
        expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      });

      // Send verification email
      const emailResult = await emailService.sendVerificationCodeEmail(user, verificationCode);

      if (emailResult.success) {
        res.status(200).json({
          success: true,
          message: 'Verification code sent successfully.'
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to send verification code'
        });
      }
    } else if (verificationType === 'phone') {
      if (user.is_phone_verified) {
        return res.status(400).json({
          success: false,
          message: 'Phone is already verified'
        });
      }

      // Generate phone verification code
      const phoneCode = generateVerificationCode();

      // Invalidate old tokens
      await PhoneVerificationToken.update(
        { used: true },
        { where: { user_id: user.id, used: false } }
      );

      await PhoneVerificationToken.create({
        user_id: user.id,
        verification_code: phoneCode,
        expires_at: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
      });

      // In production, send SMS
      logger.info(`Phone verification code sent for ${user.phone}: ${phoneCode}`);

      res.status(200).json({
        success: true,
        message: 'Verification code sent successfully.'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid verification type. Must be email or phone.'
      });
    }
  } catch (error) {
    logger.error('Request verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Verify code (generic)
const verifyCode = async (req, res) => {
  try {
    const { verificationCode } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Try email verification first
    const emailToken = await EmailVerificationToken.findOne({
      where: {
        user_id: user.id,
        verification_code: verificationCode,
        used: false
      }
    });

    if (emailToken && !emailToken.isExpired()) {
      await user.update({
        is_email_verified: true
      });
      await emailToken.update({ used: true });

      return res.status(200).json({
        success: true,
        message: 'Account verified successfully.'
      });
    }

    // Try phone verification
    const phoneToken = await PhoneVerificationToken.findOne({
      where: {
        user_id: user.id,
        verification_code: verificationCode,
        used: false
      }
    });

    if (phoneToken && !phoneToken.isExpired()) {
      await user.update({
        is_phone_verified: true
      });
      await phoneToken.update({ used: true });

      return res.status(200).json({
        success: true,
        message: 'Account verified successfully.'
      });
    }

    res.status(400).json({
      success: false,
      message: 'Invalid verification code.'
    });

  } catch (error) {
    logger.error('Verify code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Get user profile
const getMe = async (req, res) => {
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

    res.json({
      success: true,
      user: {
        id: user.id,
        fullName: `${user.first_name} ${user.last_name}`,
        email: user.email,
        phone: user.phone,
        kycStatus: user.kyc_status,
        isEmailVerified: user.is_email_verified,
        isPhoneVerified: user.is_phone_verified,
        registrationStatus: user.registration_status,
        onboardingComplete: user.registration_status === 'completed'
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

module.exports = {
  register,
  login,
  requestVerification,
  verifyCode,
  getMe
};