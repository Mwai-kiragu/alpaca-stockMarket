const { User, Wallet } = require('../models');
const alpacaService = require('../services/alpacaService');
const exchangeService = require('../services/exchangeService');
const ms = require('../services/mystocksService');
const { ensureMyStocksSubAccount } = require('../utils/ensureMyStocksAccount');
const logger = require('../utils/logger');

const getAccountInfo = async (req, res) => {
  try {
    // Get user to find their Alpaca account ID
    const user = await User.findByPk(req.user.id);

    // Get local wallet balance
    let wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      wallet = { kes_balance: 0, usd_balance: 0, frozen_kes: 0, frozen_usd: 0 };
    }
    const localKesBalance = parseFloat(wallet.kes_balance) || 0;
    const localUsdBalance = parseFloat(wallet.usd_balance) || 0;

    // Get exchange rate early
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    // Convert local wallet to USD
    const localCashUsd = localUsdBalance + (localKesBalance / exchangeRate);

    if (!user || !user.alpaca_account_id) {
      // No Alpaca account — return MyStocks wallet + local wallet for African-only users
      let msWallet = null;
      try {
        const subAccountId = await ensureMyStocksSubAccount(req.user.id);
        msWallet = await ms.getWallet(subAccountId);
      } catch (_) {}

      const apiBalance = parseFloat(msWallet?.wallet?.balance || msWallet?.balance || msWallet?.usdBalance || 0);
      const storedBalance = parseFloat(user.mystocks_wallet_balance || 0);
      const msUsdBalance = apiBalance > 0 ? apiBalance : storedBalance;
      const totalUsd = localCashUsd + msUsdBalance;

      const walletWithBalance = msWallet
        ? { ...msWallet, wallet: { ...(msWallet.wallet || {}), balance: msUsdBalance } }
        : null;

      return res.json({
        success: true,
        provider: 'mystocks',
        account: {
          alpacaAccount: null,
          localWallet: {
            kesBalance: localKesBalance,
            usdBalance: localUsdBalance,
            totalUsd: localCashUsd
          },
          myStocksWallet: walletWithBalance,
          tradingInfo: {
            canTrade: true,
            canTransfer: true,
            africanMarketsEnabled: true,
            usMarketsEnabled: false
          },
          account_mode: user?.account_mode || 'demo',
          demo_balance: parseFloat(user?.demo_balance || 0),
          isDemo: (user?.account_mode || 'demo') === 'demo',
          exchangeRate,
          totalEquity: totalUsd,
          totalEquityKES: totalUsd * exchangeRate,
          lastUpdated: new Date().toISOString()
        }
      });
    }

    // Get account information for this specific user
    const account = await alpacaService.getAccount(user.alpaca_account_id);

    // Alpaca values
    const alpacaEquity = parseFloat(account.equity || 0);
    const dayChange = parseFloat(account.unrealized_pl || 0);
    const alpacaBuyingPower = parseFloat(account.buying_power || 0);
    const alpacaCash = parseFloat(account.cash || 0);
    const longValue = parseFloat(account.long_market_value || 0);
    const shortValue = parseFloat(account.short_market_value || 0);

    // Combined totals = Alpaca + Local Wallet
    const totalEquity = alpacaEquity + localCashUsd;
    const totalCash = alpacaCash + localCashUsd;
    const totalBuyingPower = alpacaBuyingPower + localCashUsd;
    const dayChangePercent = totalEquity > 0 ? (dayChange / (totalEquity - dayChange)) * 100 : 0;

    // Check if account is closed
    const isClosed = account.status === 'ACCOUNT_CLOSED' || account.status === 'CLOSED';
    const isActive = account.status === 'ACTIVE';

    // Alpaca doesn't provide closure reasons via API
    let closureReason = null;
    if (isClosed) {
      closureReason = 'Your account has been closed. Please contact support for more information.';

      logger.warn('Account closure detected:', {
        userId: req.user.id,
        accountId: account.id,
        accountNumber: account.account_number,
        status: account.status,
        closedAt: account.created_at  // Account creation date, closure date not provided
      });
    }

    res.json({
      success: true,
      account: {
        alpacaAccount: {
          id: account.id,
          accountNumber: account.account_number,
          status: account.status,
          statusDescription: account.status_description || null,
          closedReason: closureReason,
          currency: account.currency,
          lastEquityClose: parseFloat(account.last_equity_close || 0),
          equity: totalEquity,
          equityKES: totalEquity * exchangeRate,
          cash: totalCash,
          cashKES: totalCash * exchangeRate,
          portfolioValue: totalEquity,
          portfolioValueKES: totalEquity * exchangeRate,
          buyingPower: totalBuyingPower,
          buyingPowerKES: totalBuyingPower * exchangeRate,
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
          tradingBlocked: account.trading_blocked || isClosed,
          transfersBlocked: account.transfers_blocked || isClosed,
          accountBlocked: account.account_blocked || isClosed,
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
        localWallet: {
          kesBalance: localKesBalance,
          usdBalance: localUsdBalance,
          totalUsd: localCashUsd
        },
        tradingInfo: {
          canTrade: isActive && !account.trading_blocked && !account.account_blocked,
          canTransfer: isActive && !account.transfers_blocked,
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
          withdrawalLimit: totalCash - parseFloat(account.pending_transfer_out || 0)
        },
        account_mode: user?.account_mode || 'demo',
        demo_balance: parseFloat(user?.demo_balance || 0),
        isDemo: (user?.account_mode || 'demo') === 'demo',
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
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const user = await User.findByPk(req.user.id, { attributes: ['id', 'alpaca_account_id', 'mystocks_sub_account_id'] });

    // African-only user — fetch from MyStocks orders
    if (!user?.alpaca_account_id) {
      const subAccountId = user?.mystocks_sub_account_id;
      const data = await ms.getOrders(subAccountId, { symbol, limit: Math.min(parseInt(limit), 100) });
      const orders = Array.isArray(data) ? data : (Array.isArray(data?.orders) ? data.orders : []);

      const trades = orders.map(o => ({
        id: o.orderId || o.id,
        symbol: o.symbol,
        side: (o.type || o.side || '').toLowerCase(),
        quantity: parseFloat(o.quantity || o.qty || 0),
        price: parseFloat(o.localPrice || o.price || 0),
        usdPrice: parseFloat(o.usdPrice || 0),
        value: parseFloat(o.gross || 0),
        valueKES: parseFloat(o.gross || 0) * exchangeRate,
        fee: parseFloat(o.fee || 0),
        totalCost: parseFloat(o.totalCost || 0),
        status: o.status,
        currency: o.currency || 'KES',
        transactionTime: o.createdAt || o.date || null,
        provider: 'mystocks'
      }));

      const buys = trades.filter(t => t.side === 'buy');
      const sells = trades.filter(t => t.side === 'sell');

      return res.json({
        success: true,
        provider: 'mystocks',
        trades,
        summary: {
          totalTrades: trades.length,
          totalVolume: trades.reduce((s, t) => s + t.quantity, 0),
          totalValue: trades.reduce((s, t) => s + t.value, 0),
          totalValueKES: trades.reduce((s, t) => s + t.valueKES, 0),
          buyTrades: buys.length,
          sellTrades: sells.length,
          avgTradeSize: trades.length > 0 ? trades.reduce((s, t) => s + t.value, 0) / trades.length : 0
        },
        count: trades.length,
        filters: { symbol: symbol || 'all', limit: parseInt(limit) },
        exchangeRate
      });
    }

    const activities = await alpacaService.getAccountActivities({
      activity_types: 'FILL',
      page_size: Math.min(parseInt(limit), 100),
      after,
      until
    });

    const filteredActivities = symbol
      ? activities.filter(activity => activity.symbol === symbol.toUpperCase())
      : activities;

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
      filters: { symbol: symbol || 'all', limit: parseInt(limit), dateRange: { after, until } },
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

const updateAccount = async (req, res) => {
  try {
    const { fullName, phoneNumber, address, dateOfBirth } = req.body;
    const userId = req.user.id;

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update user fields
    if (fullName) user.full_name = fullName;
    if (phoneNumber) user.phone_number = phoneNumber;
    if (address) user.address = address;
    if (dateOfBirth) user.date_of_birth = dateOfBirth;

    await user.save();

    res.json({
      success: true,
      message: 'Account updated successfully',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phoneNumber: user.phone_number,
        address: user.address,
        dateOfBirth: user.date_of_birth
      }
    });
  } catch (error) {
    logger.error('Update account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update account'
    });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Soft delete the user
    user.is_active = false;
    user.deleted_at = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Account deleted successfully. You can recover it within 30 days.'
    });
  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
};

const switchAccountMode = async (req, res) => {
  try {
    const { mode } = req.body;
    if (!['demo', 'real'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'mode must be "demo" or "real"' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (mode === 'real' && !user.is_onboarding_complete && user.kyc_status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Complete your account setup to switch to live trading',
        onboardingRequired: true,
        currentKycStatus: user.kyc_status
      });
    }

    await user.update({ account_mode: mode });
    logger.info(`User ${user.id} switched to ${mode} mode`);

    return res.json({
      success: true,
      message: `Switched to ${mode === 'demo' ? 'Paper Trading' : 'Live Trading'} mode`,
      account_mode: mode
    });
  } catch (error) {
    logger.error('Switch account mode error:', error);
    res.status(500).json({ success: false, message: 'Failed to switch account mode' });
  }
};

module.exports = {
  getAccountInfo,
  getAccountActivity,
  getAccountConfigurations,
  updateAccountConfigurations,
  getTradeHistory,
  getAccountDocuments,
  updateAccount,
  deleteAccount,
  switchAccountMode
};