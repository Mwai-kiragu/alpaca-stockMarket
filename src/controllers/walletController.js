const { Wallet, Transaction } = require('../models/Wallet');
const { User } = require('../models');
const mpesaService = require('../services/mpesaDirectService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const getWallet = async (req, res) => {
  try {
    let wallet = await Wallet.findOne({
      where: { user_id: req.user.id }
    });

    if (!wallet) {
      // Create a new wallet for the user
      wallet = await Wallet.create({
        user_id: req.user.id,
        kes_balance: 0,
        usd_balance: 0,
        frozen_kes: 0,
        frozen_usd: 0
      });

      logger.info(`Created new wallet for user ${req.user.id}`);
    }

    const exchangeRate = await exchangeService.getExchangeRate('KES', 'USD');

    // Parse all balance values as floats to ensure proper arithmetic
    const kesBalance = parseFloat(wallet.kes_balance) || 0;
    const usdBalance = parseFloat(wallet.usd_balance) || 0;
    const frozenKes = parseFloat(wallet.frozen_kes) || 0;
    const frozenUsd = parseFloat(wallet.frozen_usd) || 0;

    res.json({
      success: true,
      wallet: {
        kesBalance: kesBalance.toFixed(2),
        usdBalance: usdBalance.toFixed(2),
        availableKes: (kesBalance - frozenKes).toFixed(2),
        availableUsd: (usdBalance - frozenUsd).toFixed(2),
        frozenKes: frozenKes.toFixed(2),
        frozenUsd: frozenUsd.toFixed(2),
        totalValueKes: (kesBalance + (usdBalance / exchangeRate)).toFixed(2),
        totalValueUsd: (usdBalance + (kesBalance * exchangeRate)).toFixed(2),
        exchangeRate
      }
    });
  } catch (error) {
    logger.error('Get wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status } = req.query;
    let wallet = await Wallet.findOne({ where: { user_id: req.user.id } });

    if (!wallet) {
      // Create a new wallet for the user
      wallet = await Wallet.create({
        user_id: req.user.id,
        kes_balance: 0,
        usd_balance: 0,
        frozen_kes: 0,
        frozen_usd: 0
      });
      logger.info(`Created new wallet for user ${req.user.id} when fetching transactions`);
    }

    const whereClause = { wallet_id: wallet.id };
    if (type) whereClause.type = type;
    if (status) whereClause.status = status;

    const { count, rows: paginatedTransactions } = await Transaction.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });

    res.json({
      success: true,
      transactions: paginatedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalTransactions: count,
        hasNext: (page * limit) < count,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    logger.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const initiateDeposit = async (req, res) => {
  try {
    const { amount, phone } = req.body;

    if (amount < 10) {
      return res.status(400).json({
        success: false,
        message: 'Minimum deposit amount is KES 10'
      });
    }

    let wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      // Create a new wallet for the user
      wallet = await Wallet.create({
        user_id: req.user.id,
        kes_balance: 0,
        usd_balance: 0,
        frozen_kes: 0,
        frozen_usd: 0
      });
      logger.info(`Created new wallet for user ${req.user.id} during deposit`);
    }

    const reference = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // SANDBOX MODE: Check if we're in development and skip MPesa
    const isSandboxMode = process.env.NODE_ENV === 'development' || !process.env.MPESA_CONSUMER_KEY || process.env.MPESA_STK_CALLBACK_URL?.includes('your-domain.com');

    if (isSandboxMode) {
      // Sandbox: Instantly add money to wallet
      logger.info(`SANDBOX MODE: Simulating deposit for user ${req.user.id}`);

      // Create transaction record
      const transaction = await Transaction.create({
        wallet_id: wallet.id,
        type: 'deposit',
        amount,
        currency: 'KES',
        reference,
        description: `Sandbox deposit of KES ${amount}`,
        status: 'completed',
        metadata: {
          phone,
          method: 'sandbox',
          mpesaReceiptNumber: `SANDBOX${Date.now()}`,
          transactionDate: new Date().toISOString()
        }
      });

      // Add money to wallet
      wallet.kes_balance = parseFloat(wallet.kes_balance) + amount;
      await wallet.save();

      logger.info(`Sandbox deposit completed for user ${req.user.id}: KES ${amount}`);

      // Check if user has auto-conversion enabled
      const user = await User.findByPk(req.user.id);

      let autoConvertedUSD = 0;
      let conversionDetails = null;

      // Auto-convert to USD if user preference is enabled
      if (user && user.auto_convert_deposits) {
        try {
          const conversionAmount = amount;
          const conversion = await exchangeService.convertCurrency(conversionAmount, 'KES', 'USD');
          const forexFees = exchangeService.calculateForexFees(conversion.convertedAmount);
          const finalUSDAmount = conversion.convertedAmount - forexFees;

          // Update balances: remove KES, add USD
          wallet.kes_balance = parseFloat(wallet.kes_balance) - conversionAmount;
          wallet.usd_balance = parseFloat(wallet.usd_balance) + finalUSDAmount;
          await wallet.save();

          autoConvertedUSD = finalUSDAmount;

          // Record conversion transaction
          await Transaction.create({
            wallet_id: wallet.id,
            type: 'forex_conversion',
            amount: -conversionAmount,
            currency: 'KES',
            reference: `AUTOCONV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            exchange_rate: conversion.rate,
            fees: { forex: forexFees },
            description: `Auto-convert ${conversionAmount} KES to USD on sandbox deposit`,
            status: 'completed',
            metadata: {
              originalAmount: conversionAmount,
              convertedAmount: conversion.convertedAmount,
              forexFees,
              finalAmount: finalUSDAmount,
              rate: conversion.rate,
              autoConversion: true,
              relatedDeposit: reference
            }
          });

          await Transaction.create({
            wallet_id: wallet.id,
            type: 'forex_conversion',
            amount: finalUSDAmount,
            currency: 'USD',
            reference: `AUTOCRED_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            exchange_rate: conversion.rate,
            fees: { forex: forexFees },
            description: `Receive ${finalUSDAmount} USD from auto-conversion`,
            status: 'completed',
            metadata: {
              originalAmount: conversionAmount,
              convertedAmount: conversion.convertedAmount,
              forexFees,
              finalAmount: finalUSDAmount,
              rate: conversion.rate,
              autoConversion: true,
              relatedDeposit: reference
            }
          });

          conversionDetails = {
            kesAmount: conversionAmount,
            usdAmount: finalUSDAmount,
            rate: conversion.rate,
            fees: forexFees
          };

          logger.info(`Auto-conversion completed for sandbox deposit ${reference}:`, {
            kesAmount: conversionAmount,
            usdReceived: finalUSDAmount,
            rate: conversion.rate,
            fees: forexFees
          });

        } catch (conversionError) {
          logger.error(`Auto-conversion failed for sandbox deposit ${reference}:`, conversionError);
          // Keep KES balance as is if conversion fails
        }
      }

      const responseData = {
        success: true,
        message: autoConvertedUSD > 0
          ? '💰 Sandbox deposit completed and auto-converted to USD!'
          : '💰 Sandbox deposit completed instantly!',
        reference,
        transaction: {
          amount,
          currency: 'KES',
          status: 'completed',
          reference,
          mpesaReceiptNumber: transaction.metadata.mpesaReceiptNumber,
          newKESBalance: wallet.kes_balance,
          newUSDBalance: wallet.usd_balance
        },
        note: 'This is a sandbox/test deposit. In production, this would use real MPesa.'
      };

      if (autoConvertedUSD > 0) {
        responseData.autoConverted = true;
        responseData.conversionDetails = conversionDetails;
        responseData.message = `${responseData.message} Converted KES ${conversionDetails.kesAmount} to USD ${conversionDetails.usdAmount} at rate ${conversionDetails.rate}`;
      }

      return res.json(responseData);
    }

    // PRODUCTION MODE: Use real MPesa
    // Create transaction record
    const transaction = await Transaction.create({
      wallet_id: wallet.id,
      type: 'deposit',
      amount,
      currency: 'KES',
      reference,
      description: `MPesa deposit of KES ${amount}`,
      status: 'pending',
      metadata: {
        phone,
        method: 'mpesa'
      }
    });

    const stkResponse = await mpesaService.initiateSTKPush(
      amount,
      phone,
      reference,
      'Trading Platform Deposit'
    );

    if (stkResponse.success) {
      // Update transaction with checkout IDs
      await transaction.update({
        metadata: {
          ...transaction.metadata,
          checkoutRequestId: stkResponse.checkoutRequestId,
          merchantRequestId: stkResponse.merchantRequestId
        }
      });

      logger.info(`Deposit initiated for user ${req.user.id}:`, {
        amount,
        reference,
        phone,
        checkoutRequestId: stkResponse.checkoutRequestId
      });

      res.json({
        success: true,
        message: 'Deposit initiated. Please complete payment on your phone.',
        reference,
        checkoutRequestId: stkResponse.checkoutRequestId,
        customerMessage: stkResponse.customerMessage
      });
    } else {
      // Update transaction status to failed
      await transaction.update({
        status: 'failed'
      });

      res.status(400).json({
        success: false,
        message: 'Failed to initiate deposit. Please try again.'
      });
    }
  } catch (error) {
    logger.error('Initiate deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during deposit initiation'
    });
  }
};

const mpesaCallback = async (req, res) => {
  try {
    let { reference } = req.params;
    const callbackResult = await mpesaService.processCallback(req.body);

    // If no reference in params, try to extract from callback data
    if (!reference && callbackResult.success && req.body.Body?.stkCallback?.CheckoutRequestID) {
      const checkoutRequestId = req.body.Body.stkCallback.CheckoutRequestID;
      const wallet = await Wallet.findOne({
        'transactions.metadata.checkoutRequestId': checkoutRequestId
      });
      if (wallet) {
        const transaction = wallet.transactions.find(tx => tx.metadata.checkoutRequestId === checkoutRequestId);
        reference = transaction?.reference;
      }
    }

    if (!reference) {
      logger.error('No reference found in callback');
      return res.status(400).json({ success: false, message: 'Invalid callback' });
    }

    const wallet = await Wallet.findOne({
      'transactions.reference': reference
    });

    if (!wallet) {
      logger.error(`Wallet not found for reference: ${reference}`);
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const transaction = wallet.transactions.find(tx => tx.reference === reference);

    if (callbackResult.success && callbackResult.metadata) {
      transaction.status = 'completed';
      transaction.mpesaTransactionId = callbackResult.metadata.mpesaReceiptNumber;
      transaction.metadata.transactionDate = callbackResult.metadata.transactionDate;
      transaction.metadata.phoneNumber = callbackResult.metadata.phoneNumber;

      wallet.kes_balance += transaction.amount;

      // Check if user has auto-conversion enabled
      const user = await User.findByPk(wallet.user_id);

      let autoConvertedUSD = 0;
      let conversionDetails = null;

      // Auto-convert to USD if user preference is enabled
      if (user && user.auto_convert_deposits) {
        try {
          const conversionAmount = transaction.amount;
          const conversion = await exchangeService.convertCurrency(conversionAmount, 'KES', 'USD');
          const forexFees = exchangeService.calculateForexFees(conversion.convertedAmount);
          const finalUSDAmount = conversion.convertedAmount - forexFees;

          // Update balances: remove KES, add USD
          wallet.kes_balance -= conversionAmount;
          wallet.usd_balance += finalUSDAmount;
          autoConvertedUSD = finalUSDAmount;

          // Record conversion transaction
          const conversionTransaction = {
            type: 'forex_conversion',
            amount: -conversionAmount,
            currency: 'KES',
            reference: `AUTOCONV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            exchange_rate: conversion.rate,
            fees: { forex: forexFees },
            description: `Auto-convert ${conversionAmount} KES to USD on deposit`,
            status: 'completed',
            metadata: {
              originalAmount: conversionAmount,
              convertedAmount: conversion.convertedAmount,
              forexFees,
              finalAmount: finalUSDAmount,
              rate: conversion.rate,
              autoConversion: true,
              relatedDeposit: reference
            }
          };

          const creditTransaction = {
            type: 'forex_conversion',
            amount: finalUSDAmount,
            currency: 'USD',
            reference: `AUTOCRED_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            exchange_rate: conversion.rate,
            fees: { forex: forexFees },
            description: `Receive ${finalUSDAmount} USD from auto-conversion`,
            status: 'completed',
            metadata: {
              originalAmount: conversionAmount,
              convertedAmount: conversion.convertedAmount,
              forexFees,
              finalAmount: finalUSDAmount,
              rate: conversion.rate,
              autoConversion: true,
              relatedDeposit: reference
            }
          };

          await wallet.addTransaction(conversionTransaction);
          await wallet.addTransaction(creditTransaction);

          conversionDetails = {
            kesAmount: conversionAmount,
            usdAmount: finalUSDAmount,
            rate: conversion.rate,
            fees: forexFees
          };

          logger.info(`Auto-conversion completed for deposit ${reference}:`, {
            kesAmount: conversionAmount,
            usdReceived: finalUSDAmount,
            rate: conversion.rate,
            fees: forexFees
          });

        } catch (conversionError) {
          logger.error(`Auto-conversion failed for deposit ${reference}:`, conversionError);
          // Keep KES balance as is if conversion fails
        }
      }

      await wallet.save();

      logger.info(`Deposit completed for user ${user.email}:`, {
        amount: transaction.amount,
        reference,
        mpesaReceiptNumber: callbackResult.metadata.mpesaReceiptNumber,
        autoConverted: !!autoConvertedUSD,
        usdReceived: autoConvertedUSD
      });

      // Emit appropriate event based on conversion
      const eventData = {
        amount: transaction.amount,
        currency: 'KES',
        reference,
        newKESBalance: wallet.kes_balance,
        newUSDBalance: wallet.usd_balance
      };

      if (autoConvertedUSD > 0) {
        eventData.autoConverted = true;
        eventData.usdReceived = autoConvertedUSD;
        eventData.conversionDetails = conversionDetails;
      }

      req.app.get('io').to(user.id.toString()).emit('deposit_completed', eventData);
    } else {
      transaction.status = 'failed';
      transaction.metadata.failureReason = callbackResult.resultDesc;

      await wallet.save();

      const user = await User.findById(wallet.userId);

      logger.info(`Deposit failed for user ${user.email}:`, {
        reference,
        reason: callbackResult.resultDesc
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('MPesa callback error:', error);
    res.status(500).json({ success: false });
  }
};

const checkDepositStatus = async (req, res) => {
  try {
    const { reference } = req.params;

    const wallet = await Wallet.findOne({
      userId: req.user.id,
      'transactions.reference': reference
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const transaction = wallet.transactions.find(tx => tx.reference === reference);

    res.json({
      success: true,
      transaction: {
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        type: transaction.type,
        createdAt: transaction.createdAt,
        mpesaTransactionId: transaction.mpesaTransactionId
      }
    });
  } catch (error) {
    logger.error('Check deposit status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const convertCurrency = async (req, res) => {
  try {
    const { amount, fromCurrency, toCurrency } = req.body;

    if (!['KES', 'USD'].includes(fromCurrency) || !['KES', 'USD'].includes(toCurrency)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid currency. Only KES and USD supported.'
      });
    }

    if (fromCurrency === toCurrency) {
      return res.status(400).json({
        success: false,
        message: 'Cannot convert to the same currency'
      });
    }

    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });

    const availableBalance = fromCurrency === 'KES' ? wallet.availableKes : wallet.availableUsd;

    if (availableBalance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${fromCurrency} balance`
      });
    }

    const conversion = await exchangeService.convertCurrency(amount, fromCurrency, toCurrency);
    const forexFees = exchangeService.calculateForexFees(conversion.convertedAmount);
    const finalAmount = conversion.convertedAmount - forexFees;

    await wallet.updateBalance(amount, fromCurrency, 'subtract');
    await wallet.updateBalance(finalAmount, toCurrency, 'add');

    const conversionTransaction = {
      type: 'forex_conversion',
      amount: -amount,
      currency: fromCurrency,
      reference: `CONV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      exchangeRate: conversion.rate,
      fees: { forex: forexFees },
      description: `Convert ${amount} ${fromCurrency} to ${toCurrency}`,
      status: 'completed',
      metadata: {
        originalAmount: amount,
        convertedAmount: conversion.convertedAmount,
        forexFees,
        finalAmount,
        rate: conversion.rate
      }
    };

    const creditTransaction = {
      type: 'forex_conversion',
      amount: finalAmount,
      currency: toCurrency,
      reference: `CONV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      exchangeRate: conversion.rate,
      fees: { forex: forexFees },
      description: `Receive ${finalAmount} ${toCurrency} from conversion`,
      status: 'completed',
      metadata: {
        originalAmount: amount,
        convertedAmount: conversion.convertedAmount,
        forexFees,
        finalAmount,
        rate: conversion.rate
      }
    };

    await wallet.addTransaction(conversionTransaction);
    await wallet.addTransaction(creditTransaction);

    logger.info(`Currency conversion for user ${req.user.id}:`, {
      from: fromCurrency,
      to: toCurrency,
      originalAmount: amount,
      finalAmount,
      rate: conversion.rate,
      forexFees
    });

    res.json({
      success: true,
      message: 'Currency conversion completed',
      conversion: {
        originalAmount: amount,
        fromCurrency,
        convertedAmount: conversion.convertedAmount,
        toCurrency,
        exchangeRate: conversion.rate,
        forexFees,
        finalAmount,
        newBalances: {
          kesBalance: wallet.kesBalance,
          usdBalance: wallet.usdBalance
        }
      }
    });
  } catch (error) {
    logger.error('Currency conversion error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during currency conversion'
    });
  }
};

const initiateWithdrawal = async (req, res) => {
  try {
    const { amount, currency, method, accountDetails } = req.body;

    // Validation
    if (!['KES', 'USD'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid currency. Only KES and USD supported.'
      });
    }

    if (!method || !['mpesa', 'bank_transfer', 'paypal'].includes(method)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid withdrawal method. Supported methods: mpesa, bank_transfer, paypal'
      });
    }

    // Minimum withdrawal amounts
    const minimumAmounts = {
      KES: 50,  // Minimum KES 50
      USD: 1    // Minimum $1
    };

    if (amount < minimumAmounts[currency]) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount is ${currency} ${minimumAmounts[currency]}`
      });
    }

    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    const availableBalance = currency === 'KES' ? wallet.availableKes : wallet.availableUsd;

    if (availableBalance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${currency} balance. Available: ${availableBalance}`
      });
    }

    // Calculate withdrawal fees
    const withdrawalFees = calculateWithdrawalFees(amount, currency, method);
    const netAmount = amount - withdrawalFees;

    if (netAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal amount too small after fees'
      });
    }

    const reference = `WTH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // SANDBOX MODE: Check if we're in development
    const isSandboxMode = process.env.NODE_ENV === 'development';

    if (isSandboxMode) {
      // Sandbox: Instantly process withdrawal
      logger.info(`SANDBOX MODE: Simulating withdrawal for user ${req.user.id}`);

      // Deduct from wallet
      if (currency === 'KES') {
        wallet.kes_balance = parseFloat(wallet.kes_balance) - amount;
      } else {
        wallet.usd_balance = parseFloat(wallet.usd_balance) - amount;
      }
      await wallet.save();

      // Create completed transaction
      const transaction = await Transaction.create({
        wallet_id: wallet.id,
        type: 'withdrawal',
        amount: -amount,
        currency,
        reference,
        status: 'completed',
        fees: { withdrawal: withdrawalFees },
        description: `Sandbox ${method} withdrawal of ${currency} ${amount}`,
        metadata: {
          method,
          accountDetails,
          netAmount,
          withdrawalFees,
          processingStatus: 'completed',
          processedAt: new Date().toISOString(),
          sandbox: true
        }
      });

      logger.info(`Sandbox withdrawal completed for user ${req.user.id}: ${currency} ${amount}`);

      return res.json({
        success: true,
        message: '💸 Sandbox withdrawal completed instantly!',
        withdrawal: {
          reference,
          amount,
          currency,
          method,
          withdrawalFees,
          netAmount,
          status: 'completed',
          newBalance: currency === 'KES' ? wallet.kes_balance : wallet.usd_balance
        },
        note: 'This is a sandbox/test withdrawal. In production, this would take 1-5 business days.'
      });
    }

    // PRODUCTION MODE: Freeze funds and await approval
    await wallet.freezeFunds(amount, currency);

    const transaction = await Transaction.create({
      wallet_id: wallet.id,
      type: 'withdrawal',
      amount: -amount,
      currency,
      reference,
      status: 'pending',
      fees: { withdrawal: withdrawalFees },
      description: `${method} withdrawal of ${currency} ${amount}`,
      metadata: {
        method,
        accountDetails,
        netAmount,
        withdrawalFees,
        processingStatus: 'pending_approval'
      }
    });

    logger.info(`Withdrawal initiated for user ${req.user.id}:`, {
      amount,
      currency,
      method,
      reference,
      netAmount,
      withdrawalFees
    });

    res.json({
      success: true,
      message: 'Withdrawal initiated successfully. Processing may take 1-5 business days.',
      withdrawal: {
        reference,
        amount,
        currency,
        method,
        withdrawalFees,
        netAmount,
        status: 'pending',
        estimatedProcessingTime: getEstimatedProcessingTime(method, currency)
      }
    });

  } catch (error) {
    logger.error('Initiate withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during withdrawal initiation'
    });
  }
};

const processWithdrawal = async (req, res) => {
  try {
    const { reference } = req.params;
    const { action, adminNotes } = req.body; // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "approve" or "reject"'
      });
    }

    const transaction = await Transaction.findOne({ where: { reference } });
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (transaction.type !== 'withdrawal' || transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction for processing'
      });
    }

    const wallet = await Wallet.findOne({ where: { id: transaction.wallet_id } });

    if (action === 'approve') {
      // Process the actual withdrawal
      const success = await processActualWithdrawal(transaction);

      if (success) {
        transaction.status = 'completed';
        transaction.metadata.processingStatus = 'completed';
        transaction.metadata.processedAt = new Date();
        transaction.metadata.adminNotes = adminNotes;

        // Unfreeze and subtract from balance
        await wallet.unfreezeFunds(Math.abs(transaction.amount), transaction.currency);
        await wallet.updateBalance(Math.abs(transaction.amount), transaction.currency, 'subtract');

        logger.info(`Withdrawal approved and processed: ${reference}`);
      } else {
        transaction.status = 'failed';
        transaction.metadata.processingStatus = 'failed';
        transaction.metadata.failureReason = 'Processing failed';

        // Unfreeze funds but keep in balance
        await wallet.unfreezeFunds(Math.abs(transaction.amount), transaction.currency);

        logger.error(`Withdrawal processing failed: ${reference}`);
      }
    } else {
      // Reject withdrawal
      transaction.status = 'cancelled';
      transaction.metadata.processingStatus = 'rejected';
      transaction.metadata.rejectionReason = adminNotes || 'Withdrawn by admin';

      // Unfreeze funds but keep in balance
      await wallet.unfreezeFunds(Math.abs(transaction.amount), transaction.currency);

      logger.info(`Withdrawal rejected: ${reference}`);
    }

    await transaction.save();

    res.json({
      success: true,
      message: `Withdrawal ${action}d successfully`,
      transaction: {
        reference: transaction.reference,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency
      }
    });

  } catch (error) {
    logger.error('Process withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during withdrawal processing'
    });
  }
};

const getWithdrawalStatus = async (req, res) => {
  try {
    const { reference } = req.params;

    const transaction = await Transaction.findOne({
      where: {
        reference,
        type: 'withdrawal'
      },
      include: [{
        model: Wallet,
        as: 'wallet',
        where: { user_id: req.user.id }
      }]
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }

    res.json({
      success: true,
      withdrawal: {
        reference: transaction.reference,
        amount: Math.abs(transaction.amount),
        currency: transaction.currency,
        status: transaction.status,
        method: transaction.metadata.method,
        netAmount: transaction.metadata.netAmount,
        fees: transaction.fees,
        createdAt: transaction.createdAt,
        processedAt: transaction.metadata.processedAt,
        estimatedCompletion: transaction.metadata.estimatedCompletion,
        processingStatus: transaction.metadata.processingStatus
      }
    });

  } catch (error) {
    logger.error('Get withdrawal status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Helper functions
function calculateWithdrawalFees(amount, currency, method) {
  const feeStructure = {
    mpesa: { KES: 0.02, USD: 0.05 }, // 2% for KES, 5% for USD
    bank_transfer: { KES: 50, USD: 5 }, // Fixed fees
    paypal: { KES: 0.03, USD: 0.035 } // 3% for KES, 3.5% for USD
  };

  const fee = feeStructure[method]?.[currency] || 0;

  // If percentage-based fee
  if (fee < 1) {
    return Math.max(amount * fee, currency === 'KES' ? 10 : 1); // Minimum fees
  }

  // Fixed fee
  return fee;
}

function getEstimatedProcessingTime(method, currency) {
  const processingTimes = {
    mpesa: '1-2 hours',
    bank_transfer: currency === 'KES' ? '1-3 business days' : '3-5 business days',
    paypal: '1-2 business days'
  };

  return processingTimes[method] || '1-5 business days';
}

async function processActualWithdrawal(transaction) {
  try {
    const { method, accountDetails } = transaction.metadata;

    // This would integrate with actual payment processors
    // For now, we'll simulate success
    if (method === 'mpesa') {
      // Integrate with M-Pesa B2C API
      logger.info(`Processing M-Pesa withdrawal: ${transaction.reference}`);
      return true; // Simulated success
    } else if (method === 'bank_transfer') {
      // Integrate with bank transfer API
      logger.info(`Processing bank transfer: ${transaction.reference}`);
      return true; // Simulated success
    } else if (method === 'paypal') {
      // Integrate with PayPal API
      logger.info(`Processing PayPal withdrawal: ${transaction.reference}`);
      return true; // Simulated success
    }

    return false;
  } catch (error) {
    logger.error('Actual withdrawal processing error:', error);
    return false;
  }
}

const getCurrentExchangeRates = async (req, res) => {
  try {
    const rates = await exchangeService.getCurrentRates();

    res.json({
      success: true,
      ...rates
    });
  } catch (error) {
    logger.error('Get current exchange rates error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch current exchange rates'
    });
  }
};

const getSpecificRate = async (req, res) => {
  try {
    const { from, to } = req.params;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: 'Both from and to currencies are required'
      });
    }

    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();

    const rate = await exchangeService.getExchangeRate(fromUpper, toUpper);
    const conversion = await exchangeService.convertCurrency(1, fromUpper, toUpper);

    res.json({
      success: true,
      rate,
      pair: `${fromUpper}/${toUpper}`,
      conversion,
      timestamp: new Date().toISOString(),
      description: `1 ${fromUpper} = ${rate} ${toUpper}`
    });
  } catch (error) {
    logger.error('Get specific exchange rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exchange rate'
    });
  }
};

const updateAutoConvertPreference = async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean value'
      });
    }

    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.auto_convert_deposits = enabled;
    await user.save();

    logger.info(`Auto-conversion preference updated for user ${user.email}: ${enabled}`);

    res.json({
      success: true,
      message: `Auto-conversion ${enabled ? 'enabled' : 'disabled'} successfully`,
      autoConvertEnabled: enabled,
      note: enabled
        ? 'KES deposits will be automatically converted to USD using real-time exchange rates'
        : 'KES deposits will remain as KES until manually converted'
    });

  } catch (error) {
    logger.error('Update auto-convert preference error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating preference'
    });
  }
};

const getAutoConvertPreference = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['auto_convert_deposits', 'email']
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get current exchange rate for display
    const currentRate = await exchangeService.getExchangeRate('KES', 'USD');

    res.json({
      success: true,
      autoConvertEnabled: user.auto_convert_deposits,
      currentExchangeRate: {
        rate: currentRate,
        pair: 'KES/USD',
        description: `1 KES = ${currentRate} USD`,
        lastUpdated: new Date().toISOString()
      },
      fees: {
        forexFee: '1.5%',
        description: 'Small forex fee applied to conversions'
      },
      example: {
        kesDeposit: 5000,
        estimatedUSD: Math.round((5000 * currentRate * 0.985) * 100) / 100, // 1.5% fee
        note: 'Actual amount may vary based on real-time rates at conversion time'
      }
    });

  } catch (error) {
    logger.error('Get auto-convert preference error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching preference'
    });
  }
};

module.exports = {
  getWallet,
  getTransactions,
  initiateDeposit,
  mpesaCallback,
  checkDepositStatus,
  convertCurrency,
  initiateWithdrawal,
  processWithdrawal,
  getWithdrawalStatus,
  getCurrentExchangeRates,
  getSpecificRate,
  updateAutoConvertPreference,
  getAutoConvertPreference
};