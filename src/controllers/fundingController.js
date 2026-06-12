const { User, Wallet, Transaction } = require('../models');
const alpacaService = require('../services/alpacaService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const syncToAlpaca = async (req, res) => {
  try {
    const { amount, currency = 'USD' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Get user's wallet
    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Get user's Alpaca account
    const user = await User.findByPk(req.user.id);
    if (!user.alpaca_account_id) {
      return res.status(400).json({
        success: false,
        message: 'Alpaca account not found. Please complete KYC first.'
      });
    }

    // Validate sufficient balance
    let requiredBalance = amount;
    let sourceCurrency = currency;

    if (currency === 'KES') {
      // Check KES balance
      if (wallet.kes_balance < amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient KES balance'
        });
      }

      // Convert to USD
      const exchangeRate = await exchangeService.getExchangeRate('KES', 'USD');
      requiredBalance = amount * exchangeRate;
    } else {
      // Check USD balance
      if (wallet.usd_balance < amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient USD balance'
        });
      }
    }

    // Freeze funds in our wallet
    if (currency === 'KES') {
      await wallet.freezeFunds(amount, 'KES');
    } else {
      await wallet.freezeFunds(amount, 'USD');
    }

    try {
      // Deposit to Alpaca account
      const alpacaResult = await alpacaService.depositToAccount(
        user.alpaca_account_id,
        requiredBalance
      );

      // Deduct from our wallet
      if (currency === 'KES') {
        await wallet.deductBalance(amount, 'KES');
        await wallet.unfreezeFunds(amount, 'KES');
      } else {
        await wallet.deductBalance(amount, 'USD');
        await wallet.unfreezeFunds(amount, 'USD');
      }

      // Create transaction record
      const transaction = await Transaction.create({
        wallet_id: wallet.id,
        type: 'alpaca_deposit',
        amount: currency === 'KES' ? amount : requiredBalance,
        currency: currency,
        reference: `ALPACA_DEP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        description: `Synced ${currency} ${amount} to Alpaca trading account`,
        status: 'completed',
        metadata: {
          alpaca_account_id: user.alpaca_account_id,
          alpaca_transfer_id: alpacaResult.id,
          usd_amount: requiredBalance,
          mode: alpacaService.isSandboxMode() ? 'sandbox' : 'production'
        }
      });

      res.json({
        success: true,
        message: 'Funds synced to Alpaca successfully',
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          status: transaction.status,
          createdAt: transaction.created_at
        },
        alpacaTransfer: alpacaResult
      });

    } catch (alpacaError) {
      // Unfreeze funds if Alpaca deposit fails
      if (currency === 'KES') {
        await wallet.unfreezeFunds(amount, 'KES');
      } else {
        await wallet.unfreezeFunds(amount, 'USD');
      }

      logger.error('Alpaca deposit error:', alpacaError);
      res.status(500).json({
        success: false,
        message: 'Failed to sync funds to Alpaca',
        error: alpacaError.message
      });
    }

  } catch (error) {
    logger.error('Sync to Alpaca error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during sync'
    });
  }
};

const syncFromAlpaca = async (req, res) => {
  try {
    const { amount, currency = 'USD' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Get user's Alpaca account
    const user = await User.findByPk(req.user.id);
    if (!user.alpaca_account_id) {
      return res.status(400).json({
        success: false,
        message: 'Alpaca account not found'
      });
    }

    // Get Alpaca account balance
    const account = await alpacaService.getAccount();
    const availableCash = parseFloat(account.cash);

    if (availableCash < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient Alpaca balance'
      });
    }

    // Get or create wallet
    let wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      wallet = await Wallet.create({
        user_id: req.user.id,
        kes_balance: 0,
        usd_balance: 0,
        frozen_kes: 0,
        frozen_usd: 0
      });
    }

    // In sandbox mode, we just add to wallet (no actual Alpaca withdrawal needed)
    if (alpacaService.isSandboxMode()) {
      // Convert to target currency if needed
      let depositAmount = amount;
      if (currency === 'KES') {
        const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');
        depositAmount = amount * exchangeRate;
        await wallet.addBalance(depositAmount, 'KES');
      } else {
        await wallet.addBalance(amount, 'USD');
      }

      // Create transaction record
      const transaction = await Transaction.create({
        wallet_id: wallet.id,
        type: 'alpaca_withdrawal',
        amount: currency === 'KES' ? depositAmount : amount,
        currency: currency,
        reference: `ALPACA_WD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        description: `Synced ${currency} ${depositAmount.toFixed(2)} from Alpaca to wallet`,
        status: 'completed',
        metadata: {
          alpaca_account_id: user.alpaca_account_id,
          usd_amount: amount,
          mode: 'sandbox'
        }
      });

      res.json({
        success: true,
        message: 'Funds synced from Alpaca successfully',
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          status: transaction.status,
          createdAt: transaction.created_at
        }
      });
    } else {
      // Production: Create withdrawal (requires ACH relationship)
      return res.status(501).json({
        success: false,
        message: 'Production withdrawals require ACH setup. Please contact support.'
      });
    }

  } catch (error) {
    logger.error('Sync from Alpaca error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during sync'
    });
  }
};

const getFundingWalletStatus = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user.alpaca_account_id) {
      return res.status(400).json({
        success: false,
        message: 'Alpaca account not found'
      });
    }

    const wallet = await alpacaService.getFundingWallet(user.alpaca_account_id);
    const account = await alpacaService.getAccount();

    res.json({
      success: true,
      fundingWallet: wallet,
      tradingAccount: {
        accountId: user.alpaca_account_id,
        cash: account.cash,
        buyingPower: account.buying_power,
        equity: account.equity
      },
      mode: alpacaService.isSandboxMode() ? 'sandbox' : 'production'
    });

  } catch (error) {
    logger.error('Get funding wallet status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get funding wallet status'
    });
  }
};

const getAlpacaTransfers = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user.alpaca_account_id) {
      return res.status(400).json({
        success: false,
        message: 'Alpaca account not found'
      });
    }

    const transfers = await alpacaService.getTransfers(user.alpaca_account_id);

    res.json({
      success: true,
      transfers
    });

  } catch (error) {
    logger.error('Get Alpaca transfers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transfers'
    });
  }
};

const createBankAccount = async (req, res) => {
  try {
    const { accountOwnerName, accountType, accountNumber, routingNumber, nickname } = req.body;

    if (!accountOwnerName || !accountType || !accountNumber || !routingNumber) {
      return res.status(400).json({
        success: false,
        message: 'Missing required bank account details'
      });
    }

    const user = await User.findByPk(req.user.id);
    if (!user.alpaca_account_id) {
      return res.status(400).json({
        success: false,
        message: 'Alpaca account not found'
      });
    }

    const relationship = await alpacaService.createACHRelationship(user.alpaca_account_id, {
      accountOwnerName,
      accountType,
      accountNumber,
      routingNumber,
      nickname
    });

    res.json({
      success: true,
      message: 'Bank account linked successfully',
      relationship
    });

  } catch (error) {
    logger.error('Create bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to link bank account',
      error: error.message
    });
  }
};

const getBankAccounts = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user.alpaca_account_id) {
      return res.status(400).json({
        success: false,
        message: 'Alpaca account not found'
      });
    }

    const relationships = await alpacaService.getACHRelationships(user.alpaca_account_id);

    res.json({
      success: true,
      bankAccounts: relationships
    });

  } catch (error) {
    logger.error('Get bank accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bank accounts'
    });
  }
};

module.exports = {
  syncToAlpaca,
  syncFromAlpaca,
  getFundingWalletStatus,
  getAlpacaTransfers,
  createBankAccount,
  getBankAccounts
};
