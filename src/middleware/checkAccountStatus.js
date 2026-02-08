const { User } = require('../models');
const alpacaService = require('../services/alpacaService');
const logger = require('../utils/logger');

/**
 * Middleware to check if user's Alpaca trading account is active
 * Blocks trading and transfer operations if account is closed or blocked
 */
const checkAccountStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get user's Alpaca account ID
    const user = await User.findByPk(userId);

    if (!user || !user.alpaca_account_id) {
      return res.status(403).json({
        success: false,
        message: 'No trading account found. Complete onboarding to start trading.',
        blocked: true,
        reason: 'no_account'
      });
    }

    // Get account status from Alpaca
    const account = await alpacaService.getAccount(user.alpaca_account_id);

    // Check if account is closed
    const isClosed = account.status === 'ACCOUNT_CLOSED' || account.status === 'CLOSED';
    if (isClosed) {
      logger.warn('Blocked trading attempt on closed account:', {
        userId,
        accountId: user.alpaca_account_id,
        accountNumber: account.account_number,
        status: account.status
      });

      return res.status(403).json({
        success: false,
        message: 'Your trading account is closed and cannot be used for trading or transfers. Please contact support for assistance.',
        blocked: true,
        reason: 'account_closed'
      });
    }

    // Check if account is inactive or pending
    const inactiveStatuses = ['INACTIVE', 'DISABLED', 'REJECTED'];
    if (inactiveStatuses.includes(account.status)) {
      return res.status(403).json({
        success: false,
        message: 'Your trading account is not active. Please contact support.',
        blocked: true,
        reason: 'account_inactive',
        status: account.status
      });
    }

    // Check if trading is blocked
    if (account.trading_blocked) {
      return res.status(403).json({
        success: false,
        message: 'Trading is currently blocked on your account. Please contact support.',
        blocked: true,
        reason: 'trading_blocked'
      });
    }

    // Check if account is blocked
    if (account.account_blocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account is blocked. Please contact support.',
        blocked: true,
        reason: 'account_blocked'
      });
    }

    // Account is active, allow request to proceed
    req.alpacaAccount = account;
    next();

  } catch (error) {
    logger.error('Account status check error:', {
      userId: req.user?.id,
      error: error.message
    });

    // On error, fail safely by blocking the request
    return res.status(500).json({
      success: false,
      message: 'Unable to verify account status. Please try again.',
      blocked: true,
      reason: 'verification_error'
    });
  }
};

/**
 * Middleware to check if transfers are allowed
 */
const checkTransferStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get user's Alpaca account ID
    const user = await User.findByPk(userId);

    if (!user || !user.alpaca_account_id) {
      return res.status(403).json({
        success: false,
        message: 'No trading account found.',
        blocked: true,
        reason: 'no_account'
      });
    }

    // Get account status from Alpaca
    const account = await alpacaService.getAccount(user.alpaca_account_id);

    // Check if account is closed
    const isClosed = account.status === 'ACCOUNT_CLOSED' || account.status === 'CLOSED';
    if (isClosed) {
      return res.status(403).json({
        success: false,
        message: 'Cannot transfer funds from a closed account.',
        blocked: true,
        reason: 'account_closed'
      });
    }

    // Check if transfers are blocked
    if (account.transfers_blocked) {
      return res.status(403).json({
        success: false,
        message: 'Transfers are currently blocked on your account. Please contact support.',
        blocked: true,
        reason: 'transfers_blocked'
      });
    }

    // Transfers allowed
    req.alpacaAccount = account;
    next();

  } catch (error) {
    logger.error('Transfer status check error:', {
      userId: req.user?.id,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      message: 'Unable to verify account status. Please try again.',
      blocked: true,
      reason: 'verification_error'
    });
  }
};

module.exports = {
  checkAccountStatus,
  checkTransferStatus
};
