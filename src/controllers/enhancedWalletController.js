const { Wallet, Transaction, User } = require('../models');
const mpesaService = require('../services/mpesaDirectService');
const exchangeService = require('../services/exchangeService');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

const getWalletWithAnalytics = async (req, res) => {
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
      logger.info(`Created new wallet for user ${req.user.id} in analytics`);
    }

    // Get transactions separately to avoid association issues
    const transactions = await Transaction.findAll({
      where: { wallet_id: wallet.id },
      order: [['created_at', 'DESC']],
      limit: 50
    });

    const [kesUsdRate, usdKesRate] = await Promise.all([
      exchangeService.getExchangeRate('KES', 'USD'),
      exchangeService.getExchangeRate('USD', 'KES')
    ]);

    // Calculate analytics
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Use the transactions we fetched separately
    const recentTransactions = transactions.filter(tx =>
      new Date(tx.created_at) >= thirtyDaysAgo
    );

    // Monthly analytics
    const monthlyDeposits = recentTransactions
      .filter(tx => tx.type === 'deposit' && tx.status === 'completed')
      .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

    const monthlyWithdrawals = recentTransactions
      .filter(tx => tx.type === 'withdrawal' && tx.status === 'completed')
      .reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0);

    const monthlyTrading = recentTransactions
      .filter(tx => ['trade_buy', 'trade_sell'].includes(tx.type) && tx.status === 'completed')
      .reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0);

    const monthlyConversions = recentTransactions
      .filter(tx => tx.type === 'forex_conversion')
      .length / 2; // Divide by 2 because each conversion creates 2 transactions

    // Weekly analytics
    const weeklyTransactions = transactions.filter(tx =>
      new Date(tx.created_at) >= sevenDaysAgo
    );

    const weeklyVolume = weeklyTransactions
      .filter(tx => tx.status === 'completed')
      .reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0);

    // Total portfolio value
    const totalValueUsd = wallet.usd_balance + (wallet.kes_balance * kesUsdRate);
    const totalValueKes = wallet.kes_balance + (wallet.usd_balance * usdKesRate);

    // Transaction categories
    const transactionsByType = {};
    transactions.forEach(tx => {
      if (tx.status === 'completed') {
        transactionsByType[tx.type] = (transactionsByType[tx.type] || 0) + 1;
      }
    });

    // Spending patterns by currency
    const spendingPatterns = {
      KES: {
        deposits: transactions.filter(tx =>
          tx.type === 'deposit' && tx.currency === 'KES' && tx.status === 'completed'
        ).reduce((sum, tx) => sum + parseFloat(tx.amount), 0),
        trading: transactions.filter(tx =>
          ['trade_buy', 'trade_sell'].includes(tx.type) && tx.currency === 'KES' && tx.status === 'completed'
        ).reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0),
        conversions: transactions.filter(tx =>
          tx.type === 'forex_conversion' && tx.currency === 'KES'
        ).reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0)
      },
      USD: {
        trading: transactions.filter(tx =>
          ['trade_buy', 'trade_sell'].includes(tx.type) && tx.currency === 'USD' && tx.status === 'completed'
        ).reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0),
        conversions: transactions.filter(tx =>
          tx.type === 'forex_conversion' && tx.currency === 'USD'
        ).reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0)
      }
    };

    res.json({
      success: true,
      wallet: {
        balances: {
          kesBalance: wallet.kes_balance,
          usdBalance: wallet.usd_balance,
          availableKes: wallet.kes_balance - wallet.frozen_kes,
          availableUsd: wallet.usd_balance - wallet.frozen_usd,
          frozenKes: wallet.frozen_kes,
          frozenUsd: wallet.frozen_usd,
          totalValueUsd,
          totalValueKes
        },
        exchangeRates: {
          kesToUsd: kesUsdRate,
          usdToKes: usdKesRate,
          lastUpdated: new Date().toISOString()
        },
        analytics: {
          monthlyStats: {
            deposits: monthlyDeposits,
            withdrawals: monthlyWithdrawals,
            tradingVolume: monthlyTrading,
            conversions: monthlyConversions,
            netFlow: monthlyDeposits - monthlyWithdrawals
          },
          weeklyStats: {
            transactionCount: weeklyTransactions.length,
            volume: weeklyVolume
          },
          spendingPatterns,
          transactionsByType,
          portfolioGrowth: {
            current: totalValueUsd,
            currency: 'USD'
          }
        },
        recentTransactions: transactions.slice(0, 5).map(tx => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency,
          status: tx.status,
          description: tx.description,
          createdAt: tx.created_at
        }))
      }
    });
  } catch (error) {
    logger.error('Get wallet analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet analytics',
      error: error.message // Add error message for debugging
    });
  }
};

const getAdvancedTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      status,
      currency,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      search
    } = req.query;

    const offset = (page - 1) * limit;
    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    let whereClause = { wallet_id: wallet.id };

    if (type) whereClause.type = type;
    if (status) whereClause.status = status;
    if (currency) whereClause.currency = currency;
    if (minAmount) whereClause.amount = { [Transaction.sequelize.Sequelize.Op.gte]: parseFloat(minAmount) };
    if (maxAmount) {
      whereClause.amount = {
        ...whereClause.amount,
        [Transaction.sequelize.Sequelize.Op.lte]: parseFloat(maxAmount)
      };
    }

    if (dateFrom || dateTo) {
      whereClause.created_at = {};
      if (dateFrom) whereClause.created_at[Transaction.sequelize.Sequelize.Op.gte] = new Date(dateFrom);
      if (dateTo) whereClause.created_at[Transaction.sequelize.Sequelize.Op.lte] = new Date(dateTo);
    }

    if (search) {
      whereClause[Transaction.sequelize.Sequelize.Op.or] = [
        { description: { [Transaction.sequelize.Sequelize.Op.iLike]: `%${search}%` } },
        { reference: { [Transaction.sequelize.Sequelize.Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: transactions } = await Transaction.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Calculate summary statistics
    const summary = {
      totalTransactions: count,
      totalDeposits: await Transaction.sum('amount', {
        where: { ...whereClause, type: 'deposit', status: 'completed' }
      }) || 0,
      totalWithdrawals: Math.abs(await Transaction.sum('amount', {
        where: { ...whereClause, type: 'withdrawal', status: 'completed' }
      }) || 0),
      totalTradingVolume: Math.abs(await Transaction.sum('amount', {
        where: {
          ...whereClause,
          type: { [Transaction.sequelize.Sequelize.Op.in]: ['trade_buy', 'trade_sell'] },
          status: 'completed'
        }
      }) || 0),
      avgTransactionSize: count > 0 ? (await Transaction.avg('amount', { where: whereClause })) : 0
    };

    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const formattedTransactions = transactions.map(tx => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      currency: tx.currency,
      amountInOtherCurrency: tx.currency === 'USD' ? tx.amount * exchangeRate : tx.amount / exchangeRate,
      otherCurrency: tx.currency === 'USD' ? 'KES' : 'USD',
      status: tx.status,
      reference: tx.reference,
      description: tx.description,
      fees: tx.fees,
      exchangeRate: tx.exchange_rate,
      alpacaOrderId: tx.alpaca_order_id,
      metadata: tx.metadata,
      createdAt: tx.created_at,
      updatedAt: tx.updated_at
    }));

    res.json({
      success: true,
      transactions: formattedTransactions,
      summary,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
        hasNext: offset + parseInt(limit) < count,
        hasPrev: offset > 0
      },
      filters: {
        type, status, currency, dateFrom, dateTo, minAmount, maxAmount, search
      },
      exchangeRate
    });
  } catch (error) {
    logger.error('Get advanced transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions'
    });
  }
};

const getForexRates = async (req, res) => {
  try {
    const [kesUsdRate, usdKesRate] = await Promise.all([
      exchangeService.getExchangeRate('KES', 'USD'),
      exchangeService.getExchangeRate('USD', 'KES')
    ]);

    // Get historical rates for the past 30 days
    const historicalRates = await exchangeService.getHistoricalRates('USD', 'KES', 30);

    // Calculate rate statistics
    const rates = historicalRates.map(r => r.rate);
    const avgRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const currentRate = usdKesRate;

    const rateChange = rates.length > 1 ? currentRate - rates[rates.length - 2] : 0;
    const rateChangePercent = rates.length > 1 ? (rateChange / rates[rates.length - 2]) * 100 : 0;

    // Calculate conversion fees
    const conversionFees = {
      kesToUsd: exchangeService.calculateForexFees(1000), // Example for 1000 KES
      usdToKes: exchangeService.calculateForexFees(10), // Example for 10 USD
      feeRate: process.env.FOREX_FEE_RATE || '0.015', // 1.5% default
      minimumFee: {
        KES: parseFloat(process.env.MIN_FOREX_FEE_KES) || 50,
        USD: parseFloat(process.env.MIN_FOREX_FEE_USD) || 0.5
      }
    };

    res.json({
      success: true,
      rates: {
        current: {
          kesToUsd: kesUsdRate,
          usdToKes: usdKesRate,
          lastUpdated: new Date().toISOString()
        },
        statistics: {
          average30Days: avgRate,
          minimum30Days: minRate,
          maximum30Days: maxRate,
          currentChange: rateChange,
          currentChangePercent: rateChangePercent.toFixed(4)
        },
        historical: historicalRates,
        conversionFees
      }
    });
  } catch (error) {
    logger.error('Get forex rates error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch forex rates'
    });
  }
};

const simulateConversion = async (req, res) => {
  try {
    const { amount, fromCurrency, toCurrency } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

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

    const conversion = await exchangeService.convertCurrency(amount, fromCurrency, toCurrency);
    const forexFees = exchangeService.calculateForexFees(conversion.convertedAmount);
    const finalAmount = conversion.convertedAmount - forexFees;

    // Calculate effective rate after fees
    const effectiveRate = finalAmount / amount;

    res.json({
      success: true,
      simulation: {
        inputAmount: amount,
        inputCurrency: fromCurrency,
        exchangeRate: conversion.rate,
        convertedAmount: conversion.convertedAmount,
        forexFees,
        finalAmount,
        outputCurrency: toCurrency,
        effectiveRate,
        feePercentage: ((forexFees / conversion.convertedAmount) * 100).toFixed(2),
        rateWithFees: `1 ${fromCurrency} = ${effectiveRate.toFixed(4)} ${toCurrency} (after fees)`
      }
    });
  } catch (error) {
    logger.error('Currency conversion simulation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to simulate conversion'
    });
  }
};

const getWalletInsights = async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let days;
    switch (period) {
      case '7d': days = 7; break;
      case '30d': days = 30; break;
      case '90d': days = 90; break;
      case '1y': days = 365; break;
      default: days = 30;
    }

    const wallet = await Wallet.findOne({
      where: { user_id: req.user.id },
      include: [{
        model: Transaction,
        where: {
          created_at: {
            [Transaction.sequelize.Sequelize.Op.gte]: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          }
        },
        required: false,
        order: [['created_at', 'ASC']]
      }]
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    const transactions = wallet.Transactions || [];
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    // Daily balance tracking
    const dailyBalances = {};
    let runningKesBalance = 0;
    let runningUsdBalance = 0;

    // Calculate daily balances
    transactions.forEach(tx => {
      const date = tx.created_at.toISOString().split('T')[0];

      if (tx.status === 'completed') {
        if (tx.currency === 'KES') {
          runningKesBalance += parseFloat(tx.amount);
        } else if (tx.currency === 'USD') {
          runningUsdBalance += parseFloat(tx.amount);
        }
      }

      if (!dailyBalances[date]) {
        dailyBalances[date] = {
          date,
          kesBalance: runningKesBalance,
          usdBalance: runningUsdBalance,
          totalUsd: runningUsdBalance + (runningKesBalance / exchangeRate),
          transactions: []
        };
      } else {
        dailyBalances[date].kesBalance = runningKesBalance;
        dailyBalances[date].usdBalance = runningUsdBalance;
        dailyBalances[date].totalUsd = runningUsdBalance + (runningKesBalance / exchangeRate);
      }

      dailyBalances[date].transactions.push(tx);
    });

    // Transaction insights
    const insights = {
      totalTransactions: transactions.length,
      completedTransactions: transactions.filter(tx => tx.status === 'completed').length,
      pendingTransactions: transactions.filter(tx => tx.status === 'pending').length,
      failedTransactions: transactions.filter(tx => tx.status === 'failed').length,

      // Volume insights
      totalDepositVolume: transactions
        .filter(tx => tx.type === 'deposit' && tx.status === 'completed')
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0),

      totalTradingVolume: transactions
        .filter(tx => ['trade_buy', 'trade_sell'].includes(tx.type) && tx.status === 'completed')
        .reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0),

      totalConversions: transactions.filter(tx => tx.type === 'forex_conversion').length / 2,

      // Average transaction values
      avgDepositSize: 0,
      avgTradeSize: 0,

      // Currency usage
      kesTransactions: transactions.filter(tx => tx.currency === 'KES').length,
      usdTransactions: transactions.filter(tx => tx.currency === 'USD').length,

      // Top trading days
      mostActiveDay: null,

      // Fees paid
      totalFeesPaid: transactions.reduce((sum, tx) => {
        if (tx.fees) {
          return sum + Object.values(tx.fees).reduce((feeSum, fee) => feeSum + parseFloat(fee || 0), 0);
        }
        return sum;
      }, 0)
    };

    // Calculate averages
    const deposits = transactions.filter(tx => tx.type === 'deposit' && tx.status === 'completed');
    if (deposits.length > 0) {
      insights.avgDepositSize = deposits.reduce((sum, tx) => sum + parseFloat(tx.amount), 0) / deposits.length;
    }

    const trades = transactions.filter(tx => ['trade_buy', 'trade_sell'].includes(tx.type) && tx.status === 'completed');
    if (trades.length > 0) {
      insights.avgTradeSize = trades.reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0) / trades.length;
    }

    // Find most active day
    const dailyActivity = {};
    transactions.forEach(tx => {
      const date = tx.created_at.toISOString().split('T')[0];
      dailyActivity[date] = (dailyActivity[date] || 0) + 1;
    });

    if (Object.keys(dailyActivity).length > 0) {
      insights.mostActiveDay = Object.entries(dailyActivity).reduce((a, b) =>
        dailyActivity[a[0]] > dailyActivity[b[0]] ? a : b
      );
    }

    // Portfolio growth calculation
    const balanceHistory = Object.values(dailyBalances).sort((a, b) => new Date(a.date) - new Date(b.date));
    const portfolioGrowth = balanceHistory.length > 1
      ? ((balanceHistory[balanceHistory.length - 1].totalUsd - balanceHistory[0].totalUsd) / balanceHistory[0].totalUsd) * 100
      : 0;

    res.json({
      success: true,
      insights,
      portfolioGrowth: portfolioGrowth.toFixed(2),
      balanceHistory: balanceHistory.slice(-30), // Last 30 data points
      period,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Get wallet insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate wallet insights'
    });
  }
};

const bulkConvertCurrency = async (req, res) => {
  try {
    const { conversions } = req.body;

    if (!Array.isArray(conversions) || conversions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Conversions array is required and cannot be empty'
      });
    }

    if (conversions.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 conversions allowed per bulk request'
      });
    }

    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Validate all conversions first
    const validationErrors = [];
    let totalKesRequired = 0;
    let totalUsdRequired = 0;

    for (let i = 0; i < conversions.length; i++) {
      const { amount, fromCurrency, toCurrency } = conversions[i];

      if (!['KES', 'USD'].includes(fromCurrency) || !['KES', 'USD'].includes(toCurrency)) {
        validationErrors.push(`Conversion ${i + 1}: Invalid currency`);
      }

      if (fromCurrency === toCurrency) {
        validationErrors.push(`Conversion ${i + 1}: Cannot convert to same currency`);
      }

      if (amount <= 0) {
        validationErrors.push(`Conversion ${i + 1}: Amount must be positive`);
      }

      if (fromCurrency === 'KES') {
        totalKesRequired += amount;
      } else {
        totalUsdRequired += amount;
      }
    }

    // Check balances
    if (totalKesRequired > wallet.kes_balance - wallet.frozen_kes) {
      validationErrors.push('Insufficient KES balance for all conversions');
    }

    if (totalUsdRequired > wallet.usd_balance - wallet.frozen_usd) {
      validationErrors.push('Insufficient USD balance for all conversions');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: validationErrors
      });
    }

    // Process conversions
    const results = [];
    const transactionsToCreate = [];

    for (const conversion of conversions) {
      const { amount, fromCurrency, toCurrency } = conversion;

      const conversionResult = await exchangeService.convertCurrency(amount, fromCurrency, toCurrency);
      const forexFees = exchangeService.calculateForexFees(conversionResult.convertedAmount);
      const finalAmount = conversionResult.convertedAmount - forexFees;

      // Update balances
      if (fromCurrency === 'KES') {
        wallet.kes_balance -= amount;
      } else {
        wallet.usd_balance -= amount;
      }

      if (toCurrency === 'KES') {
        wallet.kes_balance += finalAmount;
      } else {
        wallet.usd_balance += finalAmount;
      }

      // Create debit transaction
      transactionsToCreate.push({
        wallet_id: wallet.id,
        type: 'forex_conversion',
        amount: -amount,
        currency: fromCurrency,
        status: 'completed',
        reference: `BULK_CONV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        description: `Bulk convert ${amount} ${fromCurrency} to ${toCurrency}`,
        exchange_rate: conversionResult.rate,
        fees: { forex: forexFees },
        metadata: {
          bulkConversion: true,
          originalAmount: amount,
          convertedAmount: conversionResult.convertedAmount,
          finalAmount,
          forexFees,
          rate: conversionResult.rate
        }
      });

      // Create credit transaction
      transactionsToCreate.push({
        wallet_id: wallet.id,
        type: 'forex_conversion',
        amount: finalAmount,
        currency: toCurrency,
        status: 'completed',
        reference: `BULK_CONV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        description: `Bulk receive ${finalAmount} ${toCurrency} from conversion`,
        exchange_rate: conversionResult.rate,
        fees: { forex: forexFees },
        metadata: {
          bulkConversion: true,
          originalAmount: amount,
          convertedAmount: conversionResult.convertedAmount,
          finalAmount,
          forexFees,
          rate: conversionResult.rate
        }
      });

      results.push({
        originalAmount: amount,
        fromCurrency,
        convertedAmount: conversionResult.convertedAmount,
        toCurrency,
        exchangeRate: conversionResult.rate,
        forexFees,
        finalAmount
      });
    }

    // Save wallet and create transactions
    await wallet.save();
    await Transaction.bulkCreate(transactionsToCreate);

    const user = await User.findByPk(req.user.id);

    // Send email notification
    try {
      await emailService.sendTransactionEmail(user, {
        type: 'bulk_conversion',
        amount: results.length,
        currency: 'conversions',
        status: 'completed',
        reference: 'BULK_CONVERSION'
      });
    } catch (emailError) {
      logger.warn('Failed to send bulk conversion email:', emailError);
    }

    logger.info(`Bulk currency conversion for user ${req.user.id}:`, {
      conversionsCount: conversions.length,
      totalFees: results.reduce((sum, r) => sum + r.forexFees, 0)
    });

    res.json({
      success: true,
      message: 'Bulk currency conversions completed successfully',
      results,
      summary: {
        conversionsProcessed: results.length,
        totalFeesUsd: results.reduce((sum, r) => sum + (r.toCurrency === 'USD' ? 0 : r.forexFees), 0),
        totalFeesKes: results.reduce((sum, r) => sum + (r.toCurrency === 'KES' ? 0 : r.forexFees * r.exchangeRate), 0),
        newBalances: {
          kesBalance: wallet.kes_balance,
          usdBalance: wallet.usd_balance
        }
      }
    });
  } catch (error) {
    logger.error('Bulk currency conversion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk conversions'
    });
  }
};

module.exports = {
  getWalletWithAnalytics,
  getAdvancedTransactions,
  getForexRates,
  simulateConversion,
  getWalletInsights,
  bulkConvertCurrency
};