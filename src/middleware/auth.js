const jwt = require('jsonwebtoken');
const { User, BiometricAuth } = require('../models');
const logger = require('../utils/logger');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ['password'] }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid.'
      });
    }

    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Account is suspended or closed.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid.'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during authentication.'
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Authentication required.'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    next();
  };
};

const requireKYC = (req, res, next) => {
  if (req.user.kyc_status !== 'approved') {
    return res.status(403).json({
      success: false,
      message: 'KYC verification required for this action.',
      kycStatus: req.user.kyc_status
    });
  }
  next();
};

// Middleware to require biometric authentication for specific actions
const requireBiometric = (action = 'general') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user has biometric enabled
      if (!req.user.biometric_enabled) {
        return res.status(403).json({
          success: false,
          message: 'Biometric authentication must be enabled for this action',
          requiresBiometric: true
        });
      }

      // Check security preferences
      const preferences = req.user.security_preferences || {};
      let requiresBiometric = false;

      switch (action) {
        case 'login':
          requiresBiometric = preferences.require_biometric_for_login;
          break;
        case 'transaction':
          requiresBiometric = preferences.require_biometric_for_transactions;
          break;
        default:
          requiresBiometric = true;
      }

      if (!requiresBiometric) {
        return next();
      }

      // Check if token includes biometric authentication
      const token = req.header('Authorization')?.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (!decoded.biometricAuth) {
        return res.status(403).json({
          success: false,
          message: 'Biometric authentication required for this action',
          requiresBiometric: true,
          action: action
        });
      }

      // Check if biometric auth is still valid (within timeout)
      if (decoded.deviceId) {
        const biometricAuth = await BiometricAuth.findOne({
          where: {
            user_id: req.user.id,
            device_id: decoded.deviceId,
            is_active: true
          }
        });

        if (!biometricAuth) {
          return res.status(403).json({
            success: false,
            message: 'Biometric device not found or inactive',
            requiresBiometric: true
          });
        }

        // Check timeout
        const timeoutMinutes = preferences.biometric_timeout_minutes || 15;
        const timeoutMs = timeoutMinutes * 60 * 1000;
        const lastUsed = biometricAuth.last_used_at || biometricAuth.registered_at;

        if (new Date() - new Date(lastUsed) > timeoutMs) {
          return res.status(403).json({
            success: false,
            message: 'Biometric authentication has timed out',
            requiresBiometric: true,
            timeoutMinutes: timeoutMinutes
          });
        }
      }

      next();
    } catch (error) {
      logger.error('Biometric middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error during biometric validation'
      });
    }
  };
};

// Middleware for PIN verification
const requirePin = async (req, res, next) => {
  try {
    const { pin } = req.body;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!req.user.pin_hash) {
      return res.status(403).json({
        success: false,
        message: 'PIN must be set up first',
        requiresPin: true
      });
    }

    if (!pin) {
      return res.status(400).json({
        success: false,
        message: 'PIN is required',
        requiresPin: true
      });
    }

    const bcrypt = require('bcryptjs');
    const isValidPin = await bcrypt.compare(pin, req.user.pin_hash);

    if (!isValidPin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid PIN'
      });
    }

    next();
  } catch (error) {
    logger.error('PIN middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during PIN validation'
    });
  }
};

module.exports = { auth, authorize, requireKYC, requireBiometric, requirePin };