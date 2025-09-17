const { Wallet, Transaction, User } = require('../models');
const mpesaService = require('../services/mpesaService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const getWallet = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({
      where: { user_id: req.user.id }
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    const exchangeRate = await exchangeService.getExchangeRate('KES', 'USD');

    res.json({
      success: true,
      wallet: {
        kesBalance: wallet.kes_balance,
        usdBalance: wallet.usd_balance,
        availableKes: wallet.availableKes,
        availableUsd: wallet.availableUsd,
        frozenKes: wallet.frozen_kes,
        frozenUsd: wallet.frozen_usd,
        totalValueKes: wallet.kes_balance + (wallet.usd_balance / exchangeRate),
        totalValueUsd: wallet.usd_balance + (wallet.kes_balance * exchangeRate),
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
    const wallet = await Wallet.findOne({ userId: req.user.id });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    let transactions = wallet.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (type) {
      transactions = transactions.filter(tx => tx.type === type);
    }

    if (status) {
      transactions = transactions.filter(tx => tx.status === status);
    }

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    res.json({
      success: true,
      transactions: paginatedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(transactions.length / limit),
        totalTransactions: transactions.length,
        hasNext: endIndex < transactions.length,
        hasPrev: startIndex > 0
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

    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    const reference = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const transaction = {
      type: 'deposit',
      amount,
      currency: 'KES',
      reference,
      description: `MPesa deposit of KES ${amount}`,
      metadata: {
        phone,
        method: 'mpesa'
      }
    };

    await wallet.addTransaction(transaction);

    const stkResponse = await mpesaService.initiateSTKPush(
      phone,
      amount,
      reference,
      'Trading Platform Deposit'
    );

    if (stkResponse.success) {
      const updatedTransaction = wallet.transactions.find(tx => tx.reference === reference);
      updatedTransaction.metadata.checkoutRequestId = stkResponse.checkoutRequestId;
      updatedTransaction.metadata.merchantRequestId = stkResponse.merchantRequestId;
      await wallet.save();

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
      const updatedTransaction = wallet.transactions.find(tx => tx.reference === reference);
      updatedTransaction.status = 'failed';
      await wallet.save();

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
    const { reference } = req.params;
    const callbackResult = await mpesaService.processCallback(req.body);

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

      wallet.kesBalance += transaction.amount;

      await wallet.save();

      const user = await User.findById(wallet.userId);

      logger.info(`Deposit completed for user ${user.email}:`, {
        amount: transaction.amount,
        reference,
        mpesaReceiptNumber: callbackResult.metadata.mpesaReceiptNumber
      });

      req.app.get('io').to(user.id.toString()).emit('deposit_completed', {
        amount: transaction.amount,
        currency: 'KES',
        reference,
        newBalance: wallet.kesBalance
      });
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

    const wallet = await Wallet.findOne({ userId: req.user.id });

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

module.exports = {
  getWallet,
  getTransactions,
  initiateDeposit,
  mpesaCallback,
  checkDepositStatus,
  convertCurrency
};