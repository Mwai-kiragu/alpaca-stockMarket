const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Wallet, EmailVerificationToken } = require('../models');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

const register = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;

    const existingUser = await User.findOne({
      where: {
        [User.sequelize.Sequelize.Op.or]: [
          { email },
          { phone }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    const user = await User.create({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      password
    });

    const wallet = await Wallet.create({
      user_id: user.id
    });

    // Create email verification token
    const verificationToken = EmailVerificationToken.generateToken();
    await EmailVerificationToken.create({
      user_id: user.id,
      token: verificationToken
    });

    // Send welcome email with verification link
    const emailResult = await emailService.sendWelcomeEmail(user, verificationToken);
    if (!emailResult.success) {
      logger.warn(`Failed to send welcome email to ${email}:`, emailResult.error);
    }

    const token = generateToken(user.id);

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please check your email to verify your account.',
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        kycStatus: user.kyc_status,
        isEmailVerified: user.is_email_verified,
        isPhoneVerified: user.is_phone_verified
      }
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
      where: { email }
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

    if (user.login_attempts > 0) {
      await user.update({
        login_attempts: 0,
        lock_until: null
      });
    }

    user.last_login = new Date();
    await user.save();

    const token = generateToken(user.id);

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
        isEmailVerified: user.is_email_verified,
        isPhoneVerified: user.is_phone_verified,
        role: user.role
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
    const { firstName, lastName, phone } = req.body;

    const user = await User.findById(req.user.id);

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone && phone !== user.phone) {
      const phoneExists = await User.findOne({ phone, _id: { $ne: user._id } });
      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use'
        });
      }
      user.phone = phone;
      user.isPhoneVerified = false;
    }

    await user.save();

    logger.info(`User profile updated: ${user.email}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        kycStatus: user.kycStatus,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified
      }
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
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

    // Create new verification token
    const verificationToken = EmailVerificationToken.generateToken();
    await EmailVerificationToken.create({
      user_id: user.id,
      token: verificationToken
    });

    // Send verification email
    const emailResult = await emailService.sendWelcomeEmail(user, verificationToken);

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

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  submitKYC,
  changePassword,
  forgotPassword,
  verifyEmail,
  resendVerificationEmail
};