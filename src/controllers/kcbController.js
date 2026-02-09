const kcbService = require('../services/kcbService');
const { Wallet, Transaction, User } = require('../models');
const logger = require('../utils/logger');
const { sequelize } = require('../config/database');

const depositFromBank = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.id;
    const {
      amount,
      currency = 'KES',
      kcbAccountNumber,
      accountHolderName,
      paymentDetails
    } = req.body;

    // Validate inputs
    if (!amount || amount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    if (!kcbAccountNumber) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'KCB account number is required'
      });
    }

    if (!kcbService.validateAccountNumber(kcbAccountNumber)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Invalid KCB account number format'
      });
    }

    // Validate paymentDetails length (KCB requirement: max 35 chars)
    if (paymentDetails && paymentDetails.length > 35) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Payment details must be 35 characters or less'
      });
    }

    const user = await User.findByPk(userId, { transaction });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get or create wallet
    let wallet = await Wallet.findOne({
      where: { user_id: userId },
      transaction
    });

    if (!wallet) {
      wallet = await Wallet.create({
        user_id: userId,
        kes_balance: 0,
        usd_balance: 0,
        frozen_kes: 0,
        frozen_usd: 0
      }, { transaction });
    }

    // Generate unique transaction reference
    const transactionReference = kcbService.generateTransactionReference();

    logger.info('Initiating KCB bank deposit:', {
      userId,
      amount,
      currency,
      transactionReference,
      kcbAccountNumber
    });

    // Prepare transfer data
    // Note: In this case, we're transferring FROM user's KCB account TO platform account
    // Then crediting the user's wallet
    // NOTE: paymentDetails must be MAX 35 characters per KCB requirements
    const shortReference = transactionReference.substring(0, 15);
    const transferData = {
      creditAccountNumber: process.env.KCB_CREDIT_ACCOUNT, // Platform's KCB account
      debitAccountNumber: kcbAccountNumber, // User's KCB account
      amount: amount,
      currency: currency.toUpperCase(),
      beneficiaryDetails: accountHolderName || `${user.first_name} ${user.last_name}`,
      paymentDetails: paymentDetails || `Deposit ${shortReference}`, // Max 35 chars
      transactionReference: transactionReference,
      transactionType: 'IF', // Internal Funds Transfer
      beneficiaryBankCode: '01' // KCB bank code
    };

    // Initiate transfer through KCB API
    const transferResult = await kcbService.transferFunds(transferData);

    if (!transferResult.success) {
      const isTimeout = transferResult.isTimeout || transferResult.statusCode === 504;

      if (isTimeout) {
        logger.info('Deposit timed out - creating pending transaction', {
          transactionReference,
          userId
        });

        // Note: Cannot query KCB transaction status - API subscription doesn't include access
        // Transaction will remain pending until manually verified or updated via callback
      }

      // For timeout: Create pending transaction to track status
      if (isTimeout) {
        // Create pending transaction record
        const txnRecord = await Transaction.create({
          wallet_id: wallet.id,
          type: 'deposit',
          amount: amount,
          currency: currency.toUpperCase(),
          status: 'pending',
          reference: transactionReference,
          description: `Bank deposit from KCB account ${kcbAccountNumber} (pending)`,
          metadata: {
            paymentMethod: 'kcb_bank',
            kcbAccountNumber,
            accountHolderName: transferData.beneficiaryDetails,
            timedOut: true,
            requiresStatusCheck: true
          }
        }, { transaction });

        await transaction.commit();

        logger.warn('Deposit timed out - created pending transaction:', {
          userId,
          transactionId: txnRecord.id,
          transactionReference
        });

        return res.status(202).json({
          success: false,
          message: 'Your deposit is being processed by the bank. Please check your transaction history in a few minutes. Do not retry this request.',
          status: 'processing',
          transactionReference,
          transactionId: txnRecord.id
        });
      }

      // For non-timeout errors: Rollback
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: 'Bank transfer failed',
        transactionReference
      });
    }

    // Check transfer status
    const statusCode = transferResult.statusCode;
    if (statusCode !== '0' && statusCode !== 0) {
      // Status code 0 means success, 1 means failure
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: transferResult.statusMessage || 'Transfer was not successful',
        statusCode,
        transactionReference
      });
    }

    // Transfer successful - credit user's wallet
    const currencyField = currency.toUpperCase() === 'KES' ? 'kes_balance' : 'usd_balance';
    await wallet.increment(currencyField, {
      by: amount,
      transaction
    });

    // Create transaction record
    const txnRecord = await Transaction.create({
      wallet_id: wallet.id,
      type: 'deposit',
      amount: amount,
      currency: currency.toUpperCase(),
      status: 'completed',
      reference: transactionReference,
      description: `Bank deposit from KCB account ${kcbAccountNumber}`,
      metadata: {
        paymentMethod: 'kcb_bank',
        kcbAccountNumber,
        accountHolderName: transferData.beneficiaryDetails,
        retrievalRefNumber: transferResult.retrievalRefNumber,
        kcbResponse: transferResult.data
      }
    }, { transaction });

    await transaction.commit();

    logger.info('KCB bank deposit completed:', {
      userId,
      transactionId: txnRecord.id,
      amount,
      currency,
      transactionReference
    });

    res.status(200).json({
      success: true,
      message: 'Deposit successful',
      transaction: {
        id: txnRecord.id,
        amount: txnRecord.amount,
        currency: txnRecord.currency,
        reference: txnRecord.reference,
        retrievalRefNumber: transferResult.retrievalRefNumber,
        status: txnRecord.status,
        createdAt: txnRecord.created_at
      },
      wallet: {
        balance_kes: wallet.kes_balance,
        balance_usd: wallet.usd_balance
      }
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('KCB deposit error:', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Failed to process bank deposit',
      error: error.message
    });
  }
};

const withdrawToBank = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.id;
    const {
      amount,
      currency = 'KES',
      kcbAccountNumber,
      accountHolderName,
      paymentDetails
    } = req.body;

    // Validate inputs
    if (!amount || amount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    if (!kcbAccountNumber) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'KCB account number is required'
      });
    }

    // Validate KCB account number
    if (!kcbService.validateAccountNumber(kcbAccountNumber)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Invalid KCB account number format'
      });
    }

    // Validate paymentDetails length (KCB requirement: max 35 chars)
    if (paymentDetails && paymentDetails.length > 35) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Payment details must be 35 characters or less'
      });
    }

    // Get user
    const user = await User.findByPk(userId, { transaction });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get wallet
    const wallet = await Wallet.findOne({
      where: { user_id: userId },
      transaction
    });

    if (!wallet) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Check sufficient balance
    const currencyField = currency.toUpperCase() === 'KES' ? 'kes_balance' : 'usd_balance';
    const availableBalance = wallet[currencyField];

    if (availableBalance < amount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        available: availableBalance,
        requested: amount
      });
    }

    // Freeze the amount first
    await wallet.freezeFunds(amount, currency.toUpperCase());

    const transactionReference = kcbService.generateTransactionReference();

    logger.info('Initiating KCB bank withdrawal:', {
      userId,
      amount,
      currency,
      transactionReference,
      kcbAccountNumber
    });

    // Prepare transfer data
    // Transfer FROM platform account TO user's bank account
    // NOTE: paymentDetails must be MAX 35 characters per KCB requirements
    const shortReference = transactionReference.substring(0, 15);
    const transferData = {
      creditAccountNumber: kcbAccountNumber, // User's KCB account
      debitAccountNumber: process.env.KCB_CREDIT_ACCOUNT, // Platform's KCB account
      amount: amount,
      currency: currency.toUpperCase(),
      beneficiaryDetails: accountHolderName || `${user.first_name} ${user.last_name}`,
      paymentDetails: paymentDetails || `Bank withdrawal ${shortReference}`, // Max 35 chars
      transactionReference: transactionReference,
      transactionType: 'IF',
      beneficiaryBankCode: '01'
    };

    // Initiate transfer
    const transferResult = await kcbService.transferFunds(transferData);

    if (!transferResult.success) {
      const isTimeout = transferResult.isTimeout || transferResult.statusCode === 504;

      // If timeout, check transaction status before giving up
      if (isTimeout) {
        logger.info('Bank withdrawal timed out - creating pending transaction', {
          transactionReference,
          userId
        });

        // Note: Cannot query KCB transaction status - API subscription doesn't include access
        // Transaction will remain pending until manually verified or updated via callback
      }

      // For timeout: Keep funds frozen and create pending transaction
      if (isTimeout) {
        // Create pending transaction record to prevent duplicate attempts
        const txnRecord = await Transaction.create({
          wallet_id: wallet.id,
          type: 'withdrawal',
          amount: amount,
          currency: currency.toUpperCase(),
          status: 'pending',
          reference: transactionReference,
          description: `Bank withdrawal to KCB account ${kcbAccountNumber} (pending)`,
          metadata: {
            paymentMethod: 'kcb_bank',
            kcbAccountNumber,
            accountHolderName: transferData.beneficiaryDetails,
            timedOut: true,
            requiresStatusCheck: true
          }
        }, { transaction });

        await transaction.commit();

        logger.warn('Bank withdrawal timed out - created pending transaction:', {
          userId,
          transactionId: txnRecord.id,
          transactionReference
        });

        return res.status(202).json({
          success: false,
          message: 'Your withdrawal is being processed by the bank. Please check your transaction history in a few minutes. Do not retry this request.',
          status: 'processing',
          transactionReference,
          transactionId: txnRecord.id
        });
      }

      // For non-timeout errors: Unfreeze funds and rollback
      await wallet.unfreezeFunds(amount, currency.toUpperCase());
      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: 'Bank transfer failed',
        transactionReference
      });
    }

    // Check status
    const statusCode = transferResult.statusCode;
    if (statusCode !== '0' && statusCode !== 0) {
      await wallet.unfreezeFunds(amount, currency.toUpperCase());
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: transferResult.statusMessage || 'Transfer was not successful',
        statusCode,
        transactionReference
      });
    }

    // Deduct from wallet (this also unfreezes)
    await wallet.deductFunds(amount, currency.toUpperCase());

    // Create transaction record
    const txnRecord = await Transaction.create({
      wallet_id: wallet.id,
      type: 'withdrawal',
      amount: amount,
      currency: currency.toUpperCase(),
      status: 'completed',
      reference: transactionReference,
      description: `Bank withdrawal to KCB account ${kcbAccountNumber}`,
      metadata: {
        paymentMethod: 'kcb_bank',
        kcbAccountNumber,
        accountHolderName: transferData.beneficiaryDetails,
        retrievalRefNumber: transferResult.retrievalRefNumber,
        kcbResponse: transferResult.data
      }
    }, { transaction });

    await transaction.commit();

    logger.info('KCB bank withdrawal completed:', {
      userId,
      transactionId: txnRecord.id,
      amount,
      currency,
      transactionReference
    });

    res.status(200).json({
      success: true,
      message: 'Withdrawal successful',
      transaction: {
        id: txnRecord.id,
        amount: txnRecord.amount,
        currency: txnRecord.currency,
        reference: txnRecord.reference,
        retrievalRefNumber: transferResult.retrievalRefNumber,
        status: txnRecord.status,
        createdAt: txnRecord.created_at
      },
      wallet: {
        balance_kes: wallet.kes_balance,
        balance_usd: wallet.usd_balance
      }
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('KCB withdrawal error:', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Failed to process bank withdrawal',
      error: error.message
    });
  }
};

const getTransactionStatus = async (req, res) => {
  try {
    const { transactionReference } = req.params;

    if (!transactionReference) {
      return res.status(400).json({
        success: false,
        message: 'Transaction reference is required'
      });
    }

    // Get user's wallet
    const wallet = await Wallet.findOne({
      where: { user_id: req.user.id }
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Find transaction by reference and wallet_id
    const transaction = await Transaction.findOne({
      where: {
        reference: transactionReference,
        wallet_id: wallet.id
      }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Optionally query KCB for status (if endpoint exists)
    let kcbStatus = null;
    try {
      const kcbStatusResult = await kcbService.getTransactionStatus(transactionReference);
      kcbStatus = kcbStatusResult.success ? kcbStatusResult.data : null;
    } catch (kcbError) {
      // Ignore KCB query errors - not critical
      logger.warn('KCB status query failed (non-critical):', kcbError.message);
    }

    res.status(200).json({
      success: true,
      transaction: {
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        type: transaction.type,
        status: transaction.status,
        paymentMethod: transaction.metadata?.paymentMethod || 'unknown',
        createdAt: transaction.created_at,
        metadata: transaction.metadata
      },
      kcbStatus
    });

  } catch (error) {
    logger.error('Get transaction status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction status',
      error: error.message
    });
  }
};

const validateAccount = async (req, res) => {
  try {
    const { accountNumber } = req.body;

    if (!accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Account number is required'
      });
    }

    const isValid = kcbService.validateAccountNumber(accountNumber);

    res.status(200).json({
      success: true,
      valid: isValid,
      accountNumber: accountNumber,
      message: isValid ? 'Valid KCB account number format' : 'Invalid KCB account number format'
    });

  } catch (error) {
    logger.error('Validate account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate account',
      error: error.message
    });
  }
};

const initiateSTKPush = async (req, res) => {
  try {
    const userId = req.user.id;
    const { phoneNumber, amount, transactionDescription } = req.body;

    // Validate inputs
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    // Get user
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get or create wallet
    let wallet = await Wallet.findOne({
      where: { user_id: userId }
    });

    if (!wallet) {
      wallet = await Wallet.create({
        user_id: userId,
        kes_balance: 0,
        usd_balance: 0,
        frozen_kes: 0,
        frozen_usd: 0
      });
    }

    // Generate unique invoice number
    const timestamp = Date.now();
    const invoiceNumber = `RIVEN-${userId}-${timestamp}`;

    logger.info('Initiating KCB M-Pesa STK Push:', {
      userId,
      phoneNumber,
      amount,
      invoiceNumber
    });

    // Initiate STK Push through KCB Buni
    const result = await kcbService.initiateSTKPush({
      phoneNumber,
      amount,
      invoiceNumber,
      transactionDescription: transactionDescription || `Deposit to Riven Trading - ${user.first_name}`,
      callbackUrl: process.env.KCB_STK_CALLBACK_URL || 'https://api.rivenapp.com/api/v1/callback'
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'STK Push failed',
        errorData: result.errorData
      });
    }

    // Create pending transaction record
    await Transaction.create({
      wallet_id: wallet.id,
      type: 'deposit',
      amount: amount,
      currency: 'KES',
      status: 'pending',
      reference: result.messageId,
      description: transactionDescription || 'KCB M-Pesa wallet deposit',
      metadata: {
        paymentMethod: 'kcb_mpesa',
        phoneNumber: result.phoneNumber,
        invoiceNumber: result.invoiceNumber,
        messageId: result.messageId,
        kcbResponse: result.data
      }
    });

    logger.info('KCB STK Push initiated successfully:', {
      userId,
      messageId: result.messageId,
      invoiceNumber: result.invoiceNumber
    });

    res.status(200).json({
      success: true,
      message: 'STK Push sent to your phone. Please enter your M-Pesa PIN to complete payment.',
      data: {
        messageId: result.messageId,
        invoiceNumber: result.invoiceNumber,
        phoneNumber: result.phoneNumber,
        amount: amount
      },
      statusCheckUrl: `/api/v1/kcb/stkpush/status/${result.messageId}`,
      instructions: {
        step1: 'Check your phone for M-Pesa prompt',
        step2: 'Enter your M-Pesa PIN to complete payment',
        step3: 'Wait 5-30 seconds for confirmation',
        step4: `Check payment status: GET /api/v1/kcb/stkpush/status/${result.messageId}`
      }
    });

  } catch (error) {
    logger.error('KCB STK Push error:', {
      userId: req.user?.id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Failed to initiate STK Push',
      error: error.message
    });
  }
};

const withdrawFromWallet = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.id;
    const {
      amount,
      currency = 'KES',
      kcbAccountNumber,
      phoneNumber,
      accountHolderName
    } = req.body;

    // Validate inputs
    if (!amount || amount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Minimum withdrawal amounts
    const minimumWithdrawal = currency === 'KES' ? 100 : 10;
    if (amount < minimumWithdrawal) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal is ${currency} ${minimumWithdrawal}`
      });
    }

    // Determine withdrawal method: Bank or M-Pesa
    let withdrawalMethod = null;
    let destinationAccount = null;

    if (phoneNumber) {
      // M-Pesa withdrawal
      withdrawalMethod = 'mpesa';
      destinationAccount = kcbService.formatPhoneNumber(phoneNumber);

      // Validate phone number format
      if (!destinationAccount || destinationAccount.length < 12) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number format for M-Pesa'
        });
      }
    } else if (kcbAccountNumber) {
      // Bank transfer
      withdrawalMethod = 'bank';
      destinationAccount = kcbAccountNumber;

      // Validate KCB account number format
      if (!kcbService.validateAccountNumber(kcbAccountNumber)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Invalid KCB account number format'
        });
      }
    } else {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Either KCB account number or M-Pesa phone number is required'
      });
    }

    // Get user
    const user = await User.findByPk(userId, { transaction });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get wallet
    const wallet = await Wallet.findOne({
      where: { user_id: userId },
      transaction
    });

    if (!wallet) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Check sufficient balance - AUTOMATIC VALIDATION
    const currencyField = currency.toUpperCase() === 'KES' ? 'kes_balance' : 'usd_balance';
    const availableBalance = wallet[currencyField];

    if (availableBalance < amount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient ${currency} balance`,
        available: availableBalance,
        requested: amount
      });
    }

    // CHECK FOR DUPLICATE WITHDRAWALS - Prevent user from withdrawing twice
    const recentPendingWithdrawal = await Transaction.findOne({
      where: {
        wallet_id: wallet.id,
        type: 'withdrawal',
        status: 'pending',
        created_at: {
          [require('sequelize').Op.gte]: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
        }
      },
      order: [['created_at', 'DESC']],
      transaction
    });

    if (recentPendingWithdrawal) {
      await transaction.rollback();

      // Query the status of the pending withdrawal
      const statusCheck = await kcbService.queryTransactionStatus(recentPendingWithdrawal.reference);

      logger.warn('Duplicate withdrawal attempt detected:', {
        userId,
        pendingReference: recentPendingWithdrawal.reference,
        statusCheck: statusCheck.transactionStatus
      });

      return res.status(409).json({
        success: false,
        message: 'You have a pending withdrawal. Please wait for it to complete.',
        pendingWithdrawal: {
          reference: recentPendingWithdrawal.reference,
          amount: recentPendingWithdrawal.amount,
          createdAt: recentPendingWithdrawal.created_at,
          status: statusCheck.transactionStatus || 'pending'
        }
      });
    }

    // Freeze the amount first
    const frozenField = currency.toUpperCase() === 'KES' ? 'frozen_kes' : 'frozen_usd';
    await wallet.update({
      [currencyField]: wallet[currencyField] - amount,
      [frozenField]: (wallet[frozenField] || 0) + amount
    }, { transaction });

    // Reload wallet to get updated values after freeze
    await wallet.reload({ transaction });

    const transactionReference = kcbService.generateTransactionReference();

    logger.info(`Initiating wallet withdrawal via ${withdrawalMethod}:`, {
      userId,
      amount,
      currency,
      transactionReference,
      withdrawalMethod,
      destinationAccount
    });

    // Prepare transfer data based on withdrawal method
    // NOTE: paymentDetails must be MAX 35 characters per KCB requirements
    let transferData;
    const shortReference = transactionReference.substring(0, 15); // Shorten for description

    if (withdrawalMethod === 'mpesa') {
      // Format phone number for M-Pesa (must start with 0, not 254)
      let mpesaNumber = destinationAccount.replace(/\D/g, '');
      if (mpesaNumber.startsWith('254')) {
        mpesaNumber = '0' + mpesaNumber.substring(3); // 254xxx -> 0xxx
      } else if (!mpesaNumber.startsWith('0') && mpesaNumber.length === 9) {
        mpesaNumber = '0' + mpesaNumber; // 7xxx -> 07xxx
      }

      // M-Pesa withdrawal (Mobile Money)
      transferData = {
        transactionType: 'MO', // Mobile Money
        debitAccountNumber: process.env.KCB_CREDIT_ACCOUNT, // Platform's KCB account
        creditAccountNumber: mpesaNumber, // User's M-Pesa phone number (format: 07xxxxxxxx)
        amount: amount, // Service expects 'amount', not 'debitAmount'
        paymentDetails: `Withdrawal ${shortReference}`, // Max 35 chars
        transactionReference: transactionReference,
        currency: currency.toUpperCase(),
        beneficiaryDetails: accountHolderName || `${user.first_name} ${user.last_name}`,
        beneficiaryBankCode: 'MPESA'
      };

      logger.info('M-Pesa withdrawal - formatted phone number:', {
        original: destinationAccount,
        formatted: mpesaNumber
      });
    } else {
      // Bank transfer (Internal Funds Transfer)
      transferData = {
        transactionType: 'IF', // Internal Funds Transfer
        debitAccountNumber: process.env.KCB_CREDIT_ACCOUNT, // Platform's KCB account
        creditAccountNumber: destinationAccount, // User's KCB bank account
        amount: amount, // Service expects 'amount', not 'debitAmount'
        paymentDetails: `Bank withdrawal ${shortReference}`, // Max 35 chars
        transactionReference: transactionReference,
        currency: currency.toUpperCase(),
        beneficiaryDetails: accountHolderName || `${user.first_name} ${user.last_name}`,
        beneficiaryBankCode: '01' // KCB bank code
      };
    }

    // Initiate transfer
    const transferResult = await kcbService.transferFunds(transferData);

    if (!transferResult.success) {
      const isTimeout = transferResult.isTimeout || transferResult.statusCode === 504;

      // If timeout, create pending transaction
      if (isTimeout) {
        logger.info('Wallet withdrawal timed out - creating pending transaction', {
          transactionReference,
          userId
        });

        // Note: Cannot query KCB transaction status - API subscription doesn't include access
        // Transaction will remain pending until manually verified or updated via callback
      }

      // For timeout: Keep funds frozen and create pending transaction
      if (isTimeout) {
        // Create pending transaction record to prevent duplicate attempts
        const txnRecord = await Transaction.create({
          wallet_id: wallet.id,
          type: 'withdrawal',
          amount: amount,
          currency: currency.toUpperCase(),
          status: 'pending',
          reference: transactionReference,
          description: withdrawalMethod === 'mpesa'
            ? `Wallet withdrawal to M-Pesa ${destinationAccount} (pending)`
            : `Wallet withdrawal to KCB account ${destinationAccount} (pending)`,
          metadata: {
            paymentMethod: withdrawalMethod === 'mpesa' ? 'kcb_mpesa' : 'kcb_bank',
            withdrawalMethod,
            destinationAccount,
            phoneNumber: withdrawalMethod === 'mpesa' ? destinationAccount : undefined,
            kcbAccountNumber: withdrawalMethod === 'bank' ? destinationAccount : undefined,
            accountHolderName: transferData.beneficiaryDetails,
            timedOut: true,
            requiresStatusCheck: true
          }
        }, { transaction });

        await transaction.commit();

        logger.warn('Withdrawal timed out - created pending transaction:', {
          userId,
          transactionId: txnRecord.id,
          transactionReference
        });

        return res.status(202).json({
          success: false,
          message: 'Your withdrawal is being processed by the bank. Please check your transaction history in a few minutes. Do not retry this request.',
          status: 'processing',
          transactionReference,
          transactionId: txnRecord.id
        });
      }

      // For non-timeout errors: Unfreeze funds and rollback
      await wallet.update({
        [currencyField]: wallet[currencyField] + amount,
        [frozenField]: Math.max(0, wallet[frozenField] - amount)
      }, { transaction });

      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: 'Withdrawal failed',
        transactionReference
      });
    }

    // Check status
    const statusCode = transferResult.statusCode;

    // Log full response for debugging
    logger.info('KCB transfer response details:', {
      statusCode,
      statusDescription: transferResult.statusDescription,
      statusMessage: transferResult.statusMessage,
      retrievalRefNumber: transferResult.retrievalRefNumber,
      merchantID: transferResult.merchantID,
      transactionReference
    });

    if (statusCode !== '0' && statusCode !== 0) {
      // Unfreeze funds if transfer failed
      await wallet.update({
        [currencyField]: wallet[currencyField] + amount,
        [frozenField]: Math.max(0, wallet[frozenField] - amount)
      }, { transaction });

      await transaction.rollback();

      logger.error('KCB transfer rejected:', {
        statusCode,
        statusDescription: transferResult.statusDescription,
        statusMessage: transferResult.statusMessage,
        transactionReference
      });

      return res.status(400).json({
        success: false,
        message: transferResult.statusMessage || transferResult.statusDescription || 'Transfer was not successful',
        statusCode,
        statusDescription: transferResult.statusDescription,
        transactionReference
      });
    }

    // Deduct frozen funds permanently (transfer successful)
    await wallet.update({
      [frozenField]: Math.max(0, wallet[frozenField] - amount)
    }, { transaction });

    // Create transaction record
    const txnRecord = await Transaction.create({
      wallet_id: wallet.id,
      type: 'withdrawal',
      amount: amount,
      currency: currency.toUpperCase(),
      status: 'completed',
      reference: transactionReference,
      description: withdrawalMethod === 'mpesa'
        ? `Wallet withdrawal to M-Pesa ${destinationAccount}`
        : `Wallet withdrawal to KCB account ${destinationAccount}`,
      metadata: {
        paymentMethod: withdrawalMethod === 'mpesa' ? 'kcb_mpesa' : 'kcb_bank',
        withdrawalMethod,
        destinationAccount,
        phoneNumber: withdrawalMethod === 'mpesa' ? destinationAccount : undefined,
        kcbAccountNumber: withdrawalMethod === 'bank' ? destinationAccount : undefined,
        accountHolderName: transferData.beneficiaryDetails,
        retrievalRefNumber: transferResult.retrievalRefNumber,
        kcbResponse: transferResult.data,
        withdrawalType: withdrawalMethod === 'mpesa' ? 'wallet_to_mpesa' : 'wallet_to_bank'
      }
    }, { transaction });

    await transaction.commit();

    logger.info('Wallet withdrawal completed:', {
      userId,
      transactionId: txnRecord.id,
      amount,
      currency,
      transactionReference
    });

    res.status(200).json({
      success: true,
      message: withdrawalMethod === 'mpesa'
        ? 'Withdrawal to M-Pesa successful'
        : 'Withdrawal to bank successful',
      withdrawal: {
        id: txnRecord.id,
        amount: txnRecord.amount,
        currency: txnRecord.currency,
        reference: txnRecord.reference,
        retrievalRefNumber: transferResult.retrievalRefNumber,
        status: txnRecord.status,
        method: withdrawalMethod,
        destination: destinationAccount,
        createdAt: txnRecord.created_at
      },
      wallet: {
        balance_kes: wallet.kes_balance,
        balance_usd: wallet.usd_balance
      }
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('Wallet withdrawal error:', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal',
      error: error.message
    });
  }
};

const queryWithdrawalStatus = async (req, res) => {
  try {
    const { transactionReference } = req.params;
    const userId = req.user.id;

    // Get user's wallet
    const wallet = await Wallet.findOne({
      where: { user_id: userId }
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Find transaction by reference and wallet_id
    const transaction = await Transaction.findOne({
      where: {
        reference: transactionReference,
        wallet_id: wallet.id,
        type: 'withdrawal'
      }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal transaction not found'
      });
    }

    // Query KCB for latest status (optional - may fail if API not subscribed)
    let kcbStatus = null;
    try {
      const kcbStatusResult = await kcbService.queryTransactionStatus(transactionReference);
      kcbStatus = kcbStatusResult.success ? kcbStatusResult.data : null;
    } catch (kcbError) {
      // Ignore KCB query errors - not critical
      logger.warn('KCB status query failed (non-critical):', kcbError.message);
    }

    res.status(200).json({
      success: true,
      transaction: {
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        type: transaction.type,
        status: transaction.status,
        paymentMethod: transaction.metadata?.paymentMethod || 'unknown',
        createdAt: transaction.created_at,
        metadata: transaction.metadata
      },
      kcbStatus
    });

  } catch (error) {
    logger.error('Query withdrawal status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to query withdrawal status',
      error: error.message
    });
  }
};

const checkDepositStatus = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Get user's wallet first
    const wallet = await Wallet.findOne({
      where: { user_id: userId }
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Find transaction by messageId (reference) and wallet_id
    const transaction = await Transaction.findOne({
      where: {
        reference: messageId,
        wallet_id: wallet.id,
        type: 'deposit'
      },
      include: [{
        model: Wallet,
        as: 'wallet'
      }]
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Deposit transaction not found',
        messageId
      });
    }

    // Note: Query Transaction API is not reliable (requires separate subscription)
    // Status updates happen via callback, which is the primary mechanism

    const response = {
      success: true,
      deposit: {
        messageId: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        paymentMethod: transaction.metadata?.paymentMethod || 'kcb_mpesa',
        createdAt: transaction.created_at,
        completedAt: transaction.status === 'completed' ? transaction.updated_at : null,
        metadata: transaction.metadata
      },
      wallet: {
        balance_kes: wallet.kes_balance,
        balance_usd: wallet.usd_balance
      }
    }

    // Add helpful message based on status
    if (transaction.status === 'pending') {
      response.message = 'Payment is still pending. Please complete the M-Pesa prompt on your phone.';
    } else if (transaction.status === 'completed') {
      response.message = 'Payment completed successfully! Your wallet has been credited.';
    } else if (transaction.status === 'failed') {
      response.message = `Payment failed: ${transaction.metadata?.failureReason || 'Unknown reason'}`;
    }

    res.status(200).json(response);

  } catch (error) {
    logger.error('Check deposit status error:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to check deposit status',
      error: error.message
    });
  }
};

module.exports = {
  depositFromBank,
  withdrawToBank,
  getTransactionStatus,
  validateAccount,
  initiateSTKPush,
  withdrawFromWallet,
  queryWithdrawalStatus,
  checkDepositStatus
};
