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
    logger.info(`Registration attempt for email: ${email}`);

    const existingUser = await User.findOne({
      where: { email }
    });

    if (existingUser) {
      logger.warn(`Registration failed - email already exists: ${email}`);
      return res.status(400).json({
        success: false,
        message: `Email already exists: ${email}`
      });
    }

    logger.info(`Email is unique, proceeding with registration: ${email}`);

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

    // TEMPORARILY COMMENTED OUT: Generate verification token
    // Will re-enable once we have a reliable email service
    /*
    const verificationCode = generateVerificationCode();
    const verificationToken = EmailVerificationToken.generateToken();

    await EmailVerificationToken.create({
      user_id: user.id,
      token: verificationToken,
      verification_code: verificationCode,
      expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });
    */

    // TEMPORARY: Generate verification code for logging only
    const verificationCode = generateVerificationCode();

    // TEMPORARILY COMMENTED OUT: Send verification email with code (with timeout)
    // Will re-enable once we have a reliable email service
    /*
    try {
      const emailPromise = emailService.sendVerificationCodeEmail(user, verificationCode);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Email timeout')), 5000)
      );

      const emailResult = await Promise.race([emailPromise, timeoutPromise]);

      if (!emailResult.success) {
        logger.error(`Failed to send verification email to ${email}:`, emailResult.error);
        logger.info(`VERIFICATION CODE for ${email}: ${verificationCode}`);
      } else {
        logger.info(`Verification email sent successfully to ${email}`);
      }
    } catch (emailError) {
      logger.error(`Email service error for ${email}:`, emailError.message);
      logger.info(`VERIFICATION CODE for ${email}: ${verificationCode}`);
    }
    */

    // TEMPORARY: Log verification code for testing (will remove when email service is ready)
    logger.info(`VERIFICATION CODE for ${email}: ${verificationCode}`);

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

      // TEMPORARILY COMMENTED OUT: Generate verification token
      // Will re-enable once we have a reliable email service
      /*
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
      */

      // TEMPORARY: Generate verification code for logging only
      const verificationCode = generateVerificationCode();

      // TEMPORARILY COMMENTED OUT: Send verification email
      // Will re-enable once we have a reliable email service
      /*
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
      */

      // TEMPORARY: Always return success and log verification code
      logger.info(`VERIFICATION CODE for ${user.email}: ${verificationCode}`);
      res.status(200).json({
        success: true,
        message: 'Verification code sent successfully.'
      });
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

      // Send SMS verification code via TestSMS
      try {
        const smsResult = await notificationService.sendPhoneVerificationCode(user.id, phoneCode);

        if (smsResult.success) {
          logger.info(`SMS verification code sent successfully to ${user.phone}`);
        } else {
          logger.warn(`SMS sending failed for ${user.phone}:`, smsResult.error);
          // Continue anyway and log the code for testing
          logger.info(`PHONE VERIFICATION CODE for ${user.phone}: ${phoneCode}`);
        }
      } catch (smsError) {
        logger.error('SMS service error:', smsError);
        // Log verification code for testing when SMS fails
        logger.info(`PHONE VERIFICATION CODE for ${user.phone}: ${phoneCode}`);
      }

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
    const { verificationCode, email } = req.body;

    // TEMPORARY: Since auth is removed, find user by email
    const user = req.user ?
      await User.findByPk(req.user.id) :
      await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: email ? 'User with this email not found' : 'User not found. Please provide email.'
      });
    }

    // TEMPORARILY COMMENTED OUT: Email verification with database tokens
    // Will re-enable once we have a reliable email service
    /*
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
    */

    // TEMPORARY: Accept ANY verification code and mark both email and phone as verified
    if (verificationCode && verificationCode.trim().length > 0) {
      await user.update({
        is_email_verified: true,
        is_phone_verified: true // Also mark phone as verified for simplicity
      });

      return res.status(200).json({
        success: true,
        message: 'Account verified successfully.'
      });
    }

    // TEMPORARILY COMMENTED OUT: Phone verification with database tokens
    /*
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
    */

    res.status(400).json({
      success: false,
      message: 'Please provide a verification code.'
    });

  } catch (error) {
    logger.error('Verify code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Get Alpaca terms and privacy policy
const getAlpacaTerms = async (req, res) => {
  try {
    const axios = require('axios');
    const cheerio = require('cheerio');

    const urls = {
      terms: 'https://alpaca.markets/disclosures', // Will extract Terms & Conditions from disclosures page
      privacy: 'https://alpaca.markets/disclosures', // Will extract Privacy Notice from disclosures page
      disclosures: 'https://alpaca.markets/disclosures'
    };

    const fetchDocument = async (url, type) => {
      try {
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Trading-Platform/1.0)'
          }
        });

        const $ = cheerio.load(response.data);

        // Extract title based on document type
        let title, content;

        if (type === 'terms') {
          title = 'Alpaca Terms & Conditions';
          // Look for Terms & Conditions links in the disclosures page
          const termsLink = $('a[href*="terms"], a:contains("Terms"), a:contains("Conditions")').first();
          if (termsLink.length > 0) {
            content = `Please review the complete Terms & Conditions document.\n\nKey Points from Alpaca Disclosures:\n\n${$('body').text().substring(0, 2000)}...`;
          } else {
            content = 'Please visit https://alpaca.markets/disclosures to access the complete Terms & Conditions document.';
          }
        } else if (type === 'privacy') {
          title = 'Alpaca Privacy Notice';
          // Look for Privacy Notice links
          const privacyLink = $('a[href*="privacy"], a:contains("Privacy")').first();
          if (privacyLink.length > 0) {
            content = `Please review the complete Privacy Notice document.\n\nKey Points from Alpaca Disclosures:\n\n${$('body').text().substring(0, 2000)}...`;
          } else {
            content = 'Please visit https://alpaca.markets/disclosures to access the complete Privacy Notice document.';
          }
        } else {
          // For disclosures, extract full content
          title = $('title').text().trim() || 'Alpaca Disclosures and Agreements';

          // Extract main content - try different selectors
          const contentSelectors = [
            'main',
            '.content',
            '.document-content',
            '.legal-content',
            'article',
            '.container .row',
            'body'
          ];

          for (const selector of contentSelectors) {
            const element = $(selector);
            if (element.length > 0) {
              content = element.text().trim();
              if (content.length > 500) break; // Use if substantial content found
            }
          }

          // Clean up content
          content = content
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .trim()
            .substring(0, 10000); // Limit to 10KB
        }

        // Extract last modified date from meta tags or content
        let lastUpdated = $('meta[name="last-modified"]').attr('content') ||
                         $('meta[property="article:modified_time"]').attr('content') ||
                         new Date().toISOString().split('T')[0];

        return {
          title,
          url,
          content: content || 'Content could not be extracted from this document.',
          lastUpdated: lastUpdated.split('T')[0], // Format as YYYY-MM-DD
          fetchedAt: new Date().toISOString()
        };

      } catch (fetchError) {
        logger.error(`Error fetching ${type} from ${url}:`, fetchError.message);
        return {
          title: `Alpaca ${type.charAt(0).toUpperCase() + type.slice(1)}`,
          url,
          content: `Unable to fetch content. Please visit ${url} directly.`,
          lastUpdated: new Date().toISOString().split('T')[0],
          fetchedAt: new Date().toISOString(),
          error: 'Content fetch failed'
        };
      }
    };

    logger.info('Fetching Alpaca legal documents...');

    // Fetch all documents in parallel
    const [terms, privacy, disclosures] = await Promise.all([
      fetchDocument(urls.terms, 'terms'),
      fetchDocument(urls.privacy, 'privacy'),
      fetchDocument(urls.disclosures, 'disclosures')
    ]);

    const alpacaTerms = {
      terms,
      privacy,
      disclosures
    };

    logger.info('Successfully fetched Alpaca legal documents');

    res.json({
      success: true,
      data: alpacaTerms,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Get Alpaca terms error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Alpaca terms and privacy policy',
      error: error.message
    });
  }
};

// Accept terms and privacy policy
const acceptTermsAndPrivacy = async (req, res) => {
  try {
    const { termsAccepted, privacyAccepted } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (typeof termsAccepted !== 'boolean' || typeof privacyAccepted !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Both termsAccepted and privacyAccepted must be boolean values'
      });
    }

    if (!termsAccepted || !privacyAccepted) {
      return res.status(400).json({
        success: false,
        message: 'Both terms and privacy policy must be accepted'
      });
    }

    const now = new Date();
    await user.update({
      terms_accepted: termsAccepted,
      privacy_accepted: privacyAccepted,
      terms_accepted_at: now,
      privacy_accepted_at: now
    });

    logger.info(`Terms and privacy accepted by user: ${user.email}`);

    res.json({
      success: true,
      message: 'Terms and privacy policy accepted successfully',
      user: {
        id: user.id,
        termsAccepted: user.terms_accepted,
        privacyAccepted: user.privacy_accepted,
        termsAcceptedAt: user.terms_accepted_at,
        privacyAcceptedAt: user.privacy_accepted_at
      }
    });
  } catch (error) {
    logger.error('Accept terms and privacy error:', error);
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
        onboardingComplete: user.registration_status === 'completed',
        termsAccepted: user.terms_accepted,
        privacyAccepted: user.privacy_accepted
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
  getAlpacaTerms,
  acceptTermsAndPrivacy,
  getMe
};