const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User, BiometricAuth } = require('../models');
const logger = require('../utils/logger');

// Generate biometric challenge token
const generateChallengeToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Enroll biometric authentication
const enrollBiometric = async (req, res) => {
  try {
    const { deviceId, deviceName, deviceModel, osVersion, biometricType, publicKey, biometricTemplateHash } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!deviceId || !biometricType || !publicKey || !biometricTemplateHash) {
      return res.status(400).json({
        success: false,
        message: 'Missing required biometric enrollment data'
      });
    }

    // Check if biometric auth already exists for this device
    const existingAuth = await BiometricAuth.findOne({
      where: {
        user_id: userId,
        device_id: deviceId
      }
    });

    if (existingAuth) {
      return res.status(400).json({
        success: false,
        message: 'Biometric authentication already enrolled for this device'
      });
    }

    // Create biometric authentication record
    const biometricAuth = await BiometricAuth.create({
      user_id: userId,
      device_id: deviceId,
      device_name: deviceName || 'Unknown Device',
      device_model: deviceModel,
      os_version: osVersion,
      biometric_type: biometricType,
      public_key: publicKey,
      biometric_template_hash: biometricTemplateHash,
      is_active: true,
      registered_at: new Date()
    });

    // Update user's biometric enabled status
    await User.update(
      { biometric_enabled: true },
      { where: { id: userId } }
    );

    logger.info(`Biometric authentication enrolled for user ${userId} on device ${deviceId}`);

    res.status(201).json({
      success: true,
      message: 'Biometric authentication enrolled successfully',
      data: {
        biometricId: biometricAuth.id,
        deviceId: biometricAuth.device_id,
        biometricType: biometricAuth.biometric_type,
        registeredAt: biometricAuth.registered_at
      }
    });

  } catch (error) {
    logger.error('Biometric enrollment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during biometric enrollment'
    });
  }
};

// Request biometric authentication challenge
const requestChallenge = async (req, res) => {
  try {
    const { deviceId } = req.body;
    const userId = req.user.id;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'Device ID is required'
      });
    }

    // Find active biometric authentication for device
    const biometricAuth = await BiometricAuth.findOne({
      where: {
        user_id: userId,
        device_id: deviceId,
        is_active: true
      }
    });

    if (!biometricAuth) {
      return res.status(404).json({
        success: false,
        message: 'No active biometric authentication found for this device'
      });
    }

    // Generate challenge token
    const challengeToken = generateChallengeToken();
    const tokenExpiration = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Update biometric auth with challenge token
    await biometricAuth.update({
      challenge_token: challengeToken,
      token_expires_at: tokenExpiration,
      verification_attempts: 0
    });

    res.status(200).json({
      success: true,
      message: 'Biometric challenge generated',
      data: {
        challengeToken,
        expiresAt: tokenExpiration,
        biometricType: biometricAuth.biometric_type
      }
    });

  } catch (error) {
    logger.error('Challenge generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during challenge generation'
    });
  }
};

// Verify biometric authentication
const verifyBiometric = async (req, res) => {
  try {
    const { deviceId, challengeToken, biometricResponse } = req.body;
    const userId = req.user.id;

    if (!deviceId || !challengeToken || !biometricResponse) {
      return res.status(400).json({
        success: false,
        message: 'Missing required verification data'
      });
    }

    // Find biometric authentication with challenge token
    const biometricAuth = await BiometricAuth.findOne({
      where: {
        user_id: userId,
        device_id: deviceId,
        challenge_token: challengeToken,
        is_active: true
      }
    });

    if (!biometricAuth) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired challenge token'
      });
    }

    // Check if token is expired
    if (new Date() > biometricAuth.token_expires_at) {
      return res.status(400).json({
        success: false,
        message: 'Challenge token has expired'
      });
    }

    // Check max attempts
    if (biometricAuth.verification_attempts >= biometricAuth.max_attempts) {
      await biometricAuth.update({
        challenge_token: null,
        token_expires_at: null
      });

      return res.status(429).json({
        success: false,
        message: 'Maximum verification attempts exceeded'
      });
    }

    // Increment verification attempts
    await biometricAuth.update({
      verification_attempts: biometricAuth.verification_attempts + 1
    });

    // Verify biometric response against stored template hash
    const isValidBiometric = await verifyBiometricTemplate(
      biometricResponse,
      biometricAuth.biometric_template_hash
    );

    if (!isValidBiometric) {
      return res.status(401).json({
        success: false,
        message: 'Biometric verification failed',
        attemptsRemaining: biometricAuth.max_attempts - biometricAuth.verification_attempts
      });
    }

    // Successful verification - clear challenge and update last used
    await biometricAuth.update({
      challenge_token: null,
      token_expires_at: null,
      verification_attempts: 0,
      last_used_at: new Date()
    });

    // Generate authentication token
    const token = jwt.sign(
      {
        id: userId,
        biometricAuth: true,
        deviceId: deviceId
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`Successful biometric authentication for user ${userId} on device ${deviceId}`);

    res.status(200).json({
      success: true,
      message: 'Biometric authentication successful',
      data: {
        token,
        user: {
          id: req.user.id,
          email: req.user.email,
          firstName: req.user.first_name,
          lastName: req.user.last_name
        },
        biometricType: biometricAuth.biometric_type,
        lastUsed: biometricAuth.last_used_at
      }
    });

  } catch (error) {
    logger.error('Biometric verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during biometric verification'
    });
  }
};

// Get user's biometric devices
const getBiometricDevices = async (req, res) => {
  try {
    const userId = req.user.id;

    const biometricDevices = await BiometricAuth.findAll({
      where: {
        user_id: userId,
        is_active: true
      },
      attributes: [
        'id',
        'device_id',
        'device_name',
        'device_model',
        'os_version',
        'biometric_type',
        'registered_at',
        'last_used_at'
      ],
      order: [['registered_at', 'DESC']]
    });

    res.status(200).json({
      success: true,
      message: 'Biometric devices retrieved successfully',
      data: {
        devices: biometricDevices,
        count: biometricDevices.length
      }
    });

  } catch (error) {
    logger.error('Get biometric devices error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Disable biometric authentication for a device
const disableBiometric = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.id;

    const biometricAuth = await BiometricAuth.findOne({
      where: {
        user_id: userId,
        device_id: deviceId,
        is_active: true
      }
    });

    if (!biometricAuth) {
      return res.status(404).json({
        success: false,
        message: 'Biometric authentication not found for this device'
      });
    }

    await biometricAuth.disable();

    // Check if user has any active biometric devices left
    const activeBiometrics = await BiometricAuth.count({
      where: {
        user_id: userId,
        is_active: true
      }
    });

    // If no active biometrics left, update user's biometric_enabled status
    if (activeBiometrics === 0) {
      await User.update(
        { biometric_enabled: false },
        { where: { id: userId } }
      );
    }

    logger.info(`Biometric authentication disabled for user ${userId} on device ${deviceId}`);

    res.status(200).json({
      success: true,
      message: 'Biometric authentication disabled successfully'
    });

  } catch (error) {
    logger.error('Disable biometric error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update security preferences
const updateSecurityPreferences = async (req, res) => {
  try {
    const { requireBiometricForLogin, requireBiometricForTransactions, biometricTimeoutMinutes } = req.body;
    const userId = req.user.id;

    const updateData = {};
    const preferences = {};

    if (requireBiometricForLogin !== undefined) {
      preferences.require_biometric_for_login = requireBiometricForLogin;
    }
    if (requireBiometricForTransactions !== undefined) {
      preferences.require_biometric_for_transactions = requireBiometricForTransactions;
    }
    if (biometricTimeoutMinutes !== undefined) {
      preferences.biometric_timeout_minutes = Math.min(Math.max(biometricTimeoutMinutes, 1), 60);
    }

    if (Object.keys(preferences).length > 0) {
      updateData.security_preferences = preferences;
    }

    await User.update(updateData, { where: { id: userId } });

    res.status(200).json({
      success: true,
      message: 'Security preferences updated successfully',
      data: { preferences }
    });

  } catch (error) {
    logger.error('Update security preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Set PIN for additional security
const setPin = async (req, res) => {
  try {
    const { pin } = req.body;
    const userId = req.user.id;

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits'
      });
    }

    const salt = await bcrypt.genSalt(12);
    const pinHash = await bcrypt.hash(pin, salt);

    await User.update(
      { pin_hash: pinHash },
      { where: { id: userId } }
    );

    logger.info(`PIN set for user ${userId}`);

    res.status(200).json({
      success: true,
      message: 'PIN set successfully'
    });

  } catch (error) {
    logger.error('Set PIN error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Helper function to verify biometric template
const verifyBiometricTemplate = async (response, storedHash) => {
  try {
    // In a real implementation, this would use actual biometric verification libraries
    // For demo purposes, we'll use a simple hash comparison
    const responseHash = crypto.createHash('sha256').update(response).digest('hex');
    return responseHash === storedHash;
  } catch (error) {
    logger.error('Biometric template verification error:', error);
    return false;
  }
};

module.exports = {
  enrollBiometric,
  requestChallenge,
  verifyBiometric,
  getBiometricDevices,
  disableBiometric,
  updateSecurityPreferences,
  setPin
};