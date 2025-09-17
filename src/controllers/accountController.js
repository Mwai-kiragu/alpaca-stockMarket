const { User } = require('../models');
const alpacaService = require('../services/alpacaService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const getAccountInfo = async (req, res) => {
  try {
    const account = await alpacaService.getAccount();
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const equity = parseFloat(account.equity || 0);
    const dayChange = parseFloat(account.unrealized_pl || 0);
    const dayChangePercent = equity > 0 ? (dayChange / (equity - dayChange)) * 100 : 0;
    const buyingPower = parseFloat(account.buying_power || 0);
    const cash = parseFloat(account.cash || 0);
    const longValue = parseFloat(account.long_market_value || 0);
    const shortValue = parseFloat(account.short_market_value || 0);

    res.json({
      success: true,
      account: {
        alpacaAccount: {
          id: account.id,
          accountNumber: account.account_number,
          status: account.status,
          currency: account.currency,
          lastEquityClose: parseFloat(account.last_equity_close || 0),
          equity,
          equityKES: equity * exchangeRate,
          cash,
          cashKES: cash * exchangeRate,
          portfolioValue: equity,
          portfolioValueKES: equity * exchangeRate,
          buyingPower,
          buyingPowerKES: buyingPower * exchangeRate,
          dayChange,
          dayChangeKES: dayChange * exchangeRate,
          dayChangePercent: parseFloat(dayChangePercent.toFixed(2)),
          longMarketValue: longValue,
          longMarketValueKES: longValue * exchangeRate,
          shortMarketValue: shortValue,
          shortMarketValueKES: shortValue * exchangeRate,
          initialMargin: parseFloat(account.initial_margin || 0),
          maintenanceMargin: parseFloat(account.maintenance_margin || 0),
          dayTradeCount: account.daytrade_count || 0,
          createdAt: account.created_at,
          tradingBlocked: account.trading_blocked,
          transfersBlocked: account.transfers_blocked,
          accountBlocked: account.account_blocked,
          patternDayTrader: account.pattern_day_trader,
          dayTradingBuyingPower: parseFloat(account.daytrading_buying_power || 0),
          regTBuyingPower: parseFloat(account.regt_buying_power || 0),
          cryptoBuyingPower: parseFloat(account.crypto_buying_power || 0),
          maxDayTradingBuyingPower: parseFloat(account.max_daytrading_buying_power || 0),
          maxBuyingPower: parseFloat(account.max_buying_power || 0),
          multiplier: parseFloat(account.multiplier || 1),
          accrualFees: parseFloat(account.accrued_fees || 0),
          pendingTransferOut: parseFloat(account.pending_transfer_out || 0),
          pendingTransferIn: parseFloat(account.pending_transfer_in || 0)
        },
        tradingInfo: {
          canTrade: !account.trading_blocked && !account.account_blocked,
          canTransfer: !account.transfers_blocked,
          dayTradesRemaining: Math.max(0, 3 - (account.daytrade_count || 0)),
          patternDayTrader: account.pattern_day_trader,
          maxPositions: account.multiplier >= 4 ? 500 : 100,
          marginEnabled: parseFloat(account.multiplier || 1) > 1,
          cryptoEnabled: parseFloat(account.crypto_buying_power || 0) > 0,
          optionsEnabled: false
        },
        limits: {
          dayTradingBuyingPower: parseFloat(account.daytrading_buying_power || 0),
          regTBuyingPower: parseFloat(account.regt_buying_power || 0),
          maxBuyingPower: parseFloat(account.max_buying_power || 0),
          maxDayTradingBuyingPower: parseFloat(account.max_daytrading_buying_power || 0),
          withdrawalLimit: parseFloat(account.cash || 0) - parseFloat(account.pending_transfer_out || 0)
        },
        exchangeRate,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Get account info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account information'
    });
  }
};

const getAccountActivity = async (req, res) => {
  try {
    const { activityType, limit = 50, page = 1 } = req.query;

    const params = {
      activity_types: activityType || undefined,
      page_size: Math.min(parseInt(limit), 100),
      page_token: page > 1 ? `page_${page}` : undefined
    };

    Object.keys(params).forEach(key => {
      if (params[key] === undefined) delete params[key];
    });

    const response = await alpacaService.getAccountActivities(params);
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const formattedActivities = response.map(activity => ({
      id: activity.id,
      activityType: activity.activity_type,
      date: activity.date,
      netAmount: parseFloat(activity.net_amount || 0),
      netAmountKES: parseFloat(activity.net_amount || 0) * exchangeRate,
      description: activity.description,
      symbol: activity.symbol,
      qty: activity.qty ? parseFloat(activity.qty) : null,
      price: activity.price ? parseFloat(activity.price) : null,
      side: activity.side,
      status: activity.status || 'completed',
      transactionTime: activity.transaction_time
    }));

    res.json({
      success: true,
      activities: formattedActivities,
      count: formattedActivities.length,
      filters: {
        activityType: activityType || 'all',
        limit: parseInt(limit),
        page: parseInt(page)
      },
      exchangeRate
    });
  } catch (error) {
    logger.error('Get account activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account activity'
    });
  }
};

const getAccountConfigurations = async (req, res) => {
  try {
    const configurations = await alpacaService.getAccountConfigurations();

    res.json({
      success: true,
      configurations: {
        dayTradeMarginCall: configurations.dtmc,
        dayTradeBuyingPower: configurations.dt_bp,
        tradeConfirmEmail: configurations.trade_confirm_email,
        suspendTrade: configurations.suspend_trade,
        maxMarginMultiplier: configurations.max_margin_multiplier || 1,
        maxOptionsPositionValue: configurations.max_options_position_value || 0,
        pdt: {
          enabled: configurations.pdt_check === 'entry',
          buyingPowerCheck: configurations.pdt_check,
        },
        fractionalTrading: configurations.fractional_trading || false,
        maxPositions: configurations.max_positions || 100,
        marginMultiplier: parseFloat(configurations.buying_power_multiplier || 1)
      }
    });
  } catch (error) {
    logger.error('Get account configurations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account configurations'
    });
  }
};

const updateAccountConfigurations = async (req, res) => {
  try {
    const updates = req.body;

    const allowedUpdates = [
      'trade_confirm_email',
      'max_margin_multiplier',
      'dtmc',
      'dt_bp'
    ];

    const filteredUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid configuration updates provided',
        allowedFields: allowedUpdates
      });
    }

    const updatedConfigurations = await alpacaService.updateAccountConfigurations(filteredUpdates);

    logger.info('Account configurations updated:', {
      userId: req.user.id,
      updates: filteredUpdates
    });

    res.json({
      success: true,
      message: 'Account configurations updated successfully',
      configurations: updatedConfigurations
    });
  } catch (error) {
    logger.error('Update account configurations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update account configurations'
    });
  }
};

const getTradeHistory = async (req, res) => {
  try {
    const { symbol, limit = 50, after, until } = req.query;

    const activities = await alpacaService.getAccountActivities({
      activity_types: 'FILL',
      page_size: Math.min(parseInt(limit), 100),
      after,
      until
    });

    const filteredActivities = symbol
      ? activities.filter(activity => activity.symbol === symbol.toUpperCase())
      : activities;

    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const trades = filteredActivities.map(activity => ({
      id: activity.id,
      symbol: activity.symbol,
      side: activity.side,
      quantity: parseFloat(activity.qty),
      price: parseFloat(activity.price),
      value: parseFloat(activity.qty) * parseFloat(activity.price),
      valueKES: (parseFloat(activity.qty) * parseFloat(activity.price)) * exchangeRate,
      commission: Math.abs(parseFloat(activity.net_amount) - (parseFloat(activity.qty) * parseFloat(activity.price))),
      date: activity.date,
      transactionTime: activity.transaction_time,
      orderId: activity.order_id
    }));

    const summary = {
      totalTrades: trades.length,
      totalVolume: trades.reduce((sum, trade) => sum + trade.quantity, 0),
      totalValue: trades.reduce((sum, trade) => sum + trade.value, 0),
      totalValueKES: trades.reduce((sum, trade) => sum + trade.valueKES, 0),
      buyTrades: trades.filter(t => t.side === 'buy').length,
      sellTrades: trades.filter(t => t.side === 'sell').length,
      avgTradeSize: trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.value, 0) / trades.length : 0
    };

    res.json({
      success: true,
      trades,
      summary,
      count: trades.length,
      filters: {
        symbol: symbol || 'all',
        limit: parseInt(limit),
        dateRange: { after, until }
      },
      exchangeRate
    });
  } catch (error) {
    logger.error('Get trade history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trade history'
    });
  }
};

const getAccountDocuments = async (req, res) => {
  try {
    const documents = await alpacaService.getAccountDocuments();

    const formattedDocuments = documents.map(doc => ({
      id: doc.id,
      type: doc.document_type,
      subType: doc.document_sub_type,
      date: doc.date,
      downloadUrl: doc.download_url,
      mimeType: doc.mime_type,
      filename: doc.filename
    }));

    res.json({
      success: true,
      documents: formattedDocuments,
      count: formattedDocuments.length
    });
  } catch (error) {
    logger.error('Get account documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account documents'
    });
  }
};

module.exports = {
  getAccountInfo,
  getAccountActivity,
  getAccountConfigurations,
  updateAccountConfigurations,
  getTradeHistory,
  getAccountDocuments
};