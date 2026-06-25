const { Order, User, Wallet, Transaction, MsOrder, DemoOrder } = require('../models');
const alpacaService = require('../services/alpacaService');
const ms = require('../services/mystocksService');
const exchangeService = require('../services/exchangeService');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const { audit, reqCtx } = require('../utils/auditLogger');

const platformConfigService = require('../services/platformConfigService');
const { recordRevenue } = require('../services/revenueService');

const AFRICAN_EXCHANGES = new Set(['NSE', 'NGX', 'JSE', 'GSE', 'BRVM', 'LUSE', 'EGX', 'BSE', 'SEM']);
const isAfrican = (exchange) => !!exchange && AFRICAN_EXCHANGES.has(exchange.toUpperCase());

const { ensureMyStocksSubAccount } = require('../utils/ensureMyStocksAccount');

const createOrder = async (req, res) => {
  try {
    const { symbol, side, type: orderType, qty: quantity, limit_price: limitPrice, stop_price: stopPrice, time_in_force: timeInForce, currency = 'USD', exchange } = req.body;

    const { alpacaEnabled, mystocksEnabled } = await platformConfigService.getProviderFlags();
    const user = await User.findByPk(req.user.id);

    // African exchange → MyStocks trade (or paper trade in demo mode)
    if (isAfrican(exchange)) {
      if (!mystocksEnabled) {
        return res.status(503).json({ success: false, message: 'African market trading is currently disabled.' });
      }
      const tradeType = (side || orderType || '').toUpperCase();
      if (!['BUY', 'SELL'].includes(tradeType)) {
        return res.status(400).json({ success: false, message: 'side must be BUY or SELL for African exchanges' });
      }
      const qty = parseFloat(quantity);
      if (!qty || qty <= 0) return res.status(400).json({ success: false, message: 'qty must be a positive number' });
      const msSymbol = symbol.toUpperCase();

      // Demo mode: execute as paper trade using demo balance
      const isDemo = user?.account_mode === 'demo' || process.env.NODE_ENV === 'development';
      if (isDemo) {
        const demoBalance = parseFloat(user?.demo_balance || 0);
        const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');
        let currentPrice = 0;
        let stockCurrency = 'KES';
        let priceError = null;
        try {
          const ticker = msSymbol.includes('.') ? msSymbol.split('.')[0] : msSymbol;
          const snap = await ms.getStocks({ search: ticker });
          const stocks = Array.isArray(snap) ? snap : (snap?.stocks || []);
          const stock = stocks.find(s => s.symbol?.toUpperCase() === msSymbol) || stocks[0];
          currentPrice = parseFloat(stock?.usdPrice || (stock?.price ? stock.price / exchangeRate : 0) || 0);
          stockCurrency = stock?.currency || 'KES';
        } catch (err) {
          const status = err?.response?.status;
          if (status === 503 || status === 502 || status === 504) {
            priceError = 'Market data is temporarily unavailable. Please try again in a moment.';
          } else if (err.message?.includes('timeout')) {
            priceError = 'Market data request timed out. Please try again.';
          } else {
            priceError = 'Unable to fetch current price for this stock.';
          }
        }
        if (!currentPrice || currentPrice <= 0) {
          return res.status(503).json({ success: false, message: priceError || 'Unable to fetch current price for this stock.' });
        }
        const gross = Math.round(qty * currentPrice * 100) / 100;
        const tradeFeeRate = await platformConfigService.getSetting('trade_fee_rate');
        const fee = Math.round(gross * tradeFeeRate * 100) / 100;
        if (tradeType === 'BUY') {
          const totalCost = gross + fee;
          if (demoBalance < totalCost) {
            return res.status(400).json({ success: false, message: 'Insufficient demo balance', available: parseFloat(demoBalance.toFixed(2)), required: parseFloat(totalCost.toFixed(2)) });
          }
          const newBalance = Math.round((demoBalance - totalCost) * 100) / 100;
          const demoOrder = await DemoOrder.create({ user_id: req.user.id, symbol: msSymbol, side: 'BUY', quantity: qty, price_usd: currentPrice, gross_usd: gross, fee_usd: fee, total_cost_usd: totalCost, currency: stockCurrency, exchange: exchange.toUpperCase(), balance_after: newBalance, status: 'FILLED', filled_at: new Date() });
          await user.update({ demo_balance: newBalance });
          recordRevenue('trade_fee', { userId: req.user.id, amountUsd: fee, currency: 'USD', reference: `DEMO_${demoOrder.id}` });
          return res.status(201).json({ success: true, provider: 'demo', order: { symbol: msSymbol, side: 'BUY', quantity: qty, price: currentPrice, gross, fee, totalCost, balanceAfter: newBalance } });
        } else {
          const existingOrders = await DemoOrder.findAll({ where: { user_id: req.user.id, symbol: msSymbol } });
          let netQty = 0;
          for (const o of existingOrders) { if (o.side === 'BUY') netQty += parseFloat(o.quantity); else netQty -= parseFloat(o.quantity); }
          if (netQty < qty) return res.status(400).json({ success: false, message: 'Insufficient shares', available: parseFloat(netQty.toFixed(6)), required: qty });
          const proceeds = Math.round((gross - fee) * 100) / 100;
          const newBalance = Math.round((demoBalance + proceeds) * 100) / 100;
          const demoOrder = await DemoOrder.create({ user_id: req.user.id, symbol: msSymbol, side: 'SELL', quantity: qty, price_usd: currentPrice, gross_usd: gross, fee_usd: fee, total_cost_usd: proceeds, currency: stockCurrency, exchange: exchange.toUpperCase(), balance_after: newBalance, status: 'FILLED', filled_at: new Date() });
          await user.update({ demo_balance: newBalance });
          recordRevenue('trade_fee', { userId: req.user.id, amountUsd: fee, currency: 'USD', reference: `DEMO_${demoOrder.id}` });
          return res.status(201).json({ success: true, provider: 'demo', order: { symbol: msSymbol, side: 'SELL', quantity: qty, price: currentPrice, gross, fee, proceeds, balanceAfter: newBalance } });
        }
      }

      const subAccountId = await ensureMyStocksSubAccount(req.user.id);

      // For BUY orders: auto-fund MyStocks sub-account from local KES wallet
      if (tradeType === 'BUY') {
        let currentPrice = null;
        try {
          // Strip exchange suffix (e.g. SCOM.KE → SCOM) to match MyStocks symbol format
          const ticker = msSymbol.includes('.') ? msSymbol.split('.')[0] : msSymbol;
          const snap = await ms.getStocks({ search: ticker });
          const all = Array.isArray(snap) ? snap : (snap?.stocks || []);
          const stock = all.find(s => {
            const sym = (s.symbol || '').toUpperCase();
            return sym === msSymbol || sym === ticker;
          }) || all[0];
          if (stock) currentPrice = parseFloat(stock.price || stock.currentPrice || 0);
        } catch (_) {}

        if (!currentPrice || currentPrice <= 0) {
          return res.status(503).json({ success: false, message: 'Unable to fetch current price. Please try again.' });
        }

        const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');
        const tradeFeeRate = await platformConfigService.getSetting('trade_fee_rate');
        const grossKes = qty * currentPrice;
        const feeKes = Math.round(grossKes * tradeFeeRate * 100) / 100;
        const totalKes = grossKes + feeKes;

        const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
        const kesBalance = parseFloat(wallet?.kes_balance || 0);

        if (kesBalance < totalKes) {
          return res.status(400).json({
            success: false,
            message: 'Insufficient balance',
            required: `KES ${totalKes.toFixed(2)}`,
            available: `KES ${kesBalance.toFixed(2)}`,
          });
        }

        // Convert KES → USD and deposit to MyStocks sub-account
        const usdAmount = Math.round((totalKes / exchangeRate) * 10000) / 10000;
        try {
          await ms.depositToSubAccount(subAccountId, {
            amount: usdAmount,
            currency: 'USD',
            localAmount: totalKes,
            localCurrency: 'KES',
            fxRate: exchangeRate,
            reference: `ORDER_${req.user.id}_${Date.now()}`,
          });
          await wallet.update({ kes_balance: Math.max(0, kesBalance - totalKes) });
          logger.info(`Funded MyStocks $${usdAmount} (KES ${totalKes}) for user ${req.user.id}`);
        } catch (fundErr) {
          logger.error(`MyStocks deposit failed for user ${req.user.id}: ${fundErr.message}`);
          const msError = fundErr.response?.data?.error || fundErr.response?.data?.message || '';
          const userMessage = msError.toLowerCase().includes('master wallet')
            ? 'Trading services are temporarily unavailable. Please try again later or contact support.'
            : 'Failed to fund trading account. Please try again.';
          return res.status(502).json({ success: false, message: userMessage });
        }
      }

      const data = await ms.placeTrade(subAccountId, { symbol: msSymbol, type: tradeType, quantity: qty });
      await MsOrder.create({
        user_id: req.user.id,
        order_id: data?.orderId || null,
        symbol: msSymbol,
        side: tradeType,
        quantity: qty,
        local_price: data?.localPrice || null,
        usd_price: data?.usdPrice || null,
        gross_usd: data?.gross || null,
        fee_usd: data?.fee || null,
        total_cost_usd: data?.totalCost || null,
        currency: data?.currency || 'KES',
        status: data?.status || 'FILLED',
        exchange: exchange?.toUpperCase() || 'NSE',
        wallet_balance_after: data?.newWalletBalance || null,
        filled_at: new Date()
      });
      if (data?.newWalletBalance != null) {
        const [updated] = await User.update(
          { mystocks_wallet_balance: data.newWalletBalance },
          { where: { id: req.user.id } }
        );
        logger.info(`MyStocks wallet balance updated for user ${req.user.id}: ${data.newWalletBalance} (rows updated: ${updated})`);
      }
      audit({ ...reqCtx(req), action: 'order.create', targetType: 'order', targetId: data?.orderId || null, details: { symbol, side, provider: 'mystocks', exchange } });
      return res.status(202).json({ success: true, provider: 'mystocks', data });
    }

    if (!alpacaEnabled) {
      return res.status(503).json({ success: false, message: 'US market trading is currently disabled.' });
    }

    if (!user || !user.alpaca_account_id) {
      return res.status(404).json({
        success: false,
        message: 'No trading account found. Complete onboarding to start trading.'
      });
    }

    // Get Alpaca account to check available cash
    const alpacaAccount = await alpacaService.getAccount(user.alpaca_account_id);
    const alpacaCashOnly = parseFloat(alpacaAccount.cash || 0);

    // Get local wallet balance to combine with Alpaca cash
    let wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      wallet = { kes_balance: 0, usd_balance: 0, frozen_kes: 0, frozen_usd: 0 };
    }
    const localUsdBalance = parseFloat(wallet.usd_balance) || 0;
    const localKesBalance = parseFloat(wallet.kes_balance) || 0;

    // Get exchange rate for KES to USD conversion
    const kesExchangeRate = await exchangeService.getExchangeRate('USD', 'KES');
    const localCashUsd = localUsdBalance + (localKesBalance / kesExchangeRate);

    // Combined available cash = Alpaca cash + Local wallet (matching portfolio calculation)
    const alpacaCash = alpacaCashOnly + localCashUsd;

    // Get current stock price for order value calculation
    const quote = await alpacaService.getLatestQuote(symbol);

    // Validate and parse prices
    let estimatedPrice = 0;
    if (limitPrice) {
      estimatedPrice = parseFloat(limitPrice);
    } else if (quote.ap) {
      estimatedPrice = parseFloat(quote.ap);
    } else if (quote.bp) {
      estimatedPrice = parseFloat(quote.bp);
    }

    // Validate estimated price
    if (!estimatedPrice || isNaN(estimatedPrice) || estimatedPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Unable to determine stock price. Please try again or use a limit order.',
        error: 'Price unavailable'
      });
    }

    const parsedQuantity = parseFloat(quantity);
    if (!parsedQuantity || isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quantity',
        error: 'Quantity must be a positive number'
      });
    }

    const orderValue = parsedQuantity * estimatedPrice;

    // Broker limitation: minimum order value is $1
    const MIN_ORDER_VALUE_USD = 1;
    if (orderValue < MIN_ORDER_VALUE_USD) {
      const minQuantity = Math.ceil((MIN_ORDER_VALUE_USD / estimatedPrice) * 10000) / 10000;
      return res.status(400).json({
        success: false,
        message: 'Order value is below the minimum required',
        error: {
          type: 'minimum_order_value',
          orderValue: `$${orderValue.toFixed(4)}`,
          minimumRequired: `$${MIN_ORDER_VALUE_USD}`,
          currentPrice: `$${estimatedPrice.toFixed(2)}`,
          currentQuantity: parsedQuantity,
          minimumQuantity: minQuantity,
          suggestion: `Increase quantity to at least ${minQuantity} shares to meet the $${MIN_ORDER_VALUE_USD} minimum order value`
        }
      });
    }

    const COMMISSION_RATE = await platformConfigService.getSetting('trade_fee_rate');
    const commissionUsd = orderValue * COMMISSION_RATE;
    const totalCostUsd = orderValue + commissionUsd;

    // Reuse exchange rate from above (kesExchangeRate)
    const exchangeRate = kesExchangeRate;

    // Calculate values in KES for display
    const orderValueKes = orderValue * exchangeRate;
    const commissionKes = commissionUsd * exchangeRate;
    const totalCostKes = totalCostUsd * exchangeRate;

    // Check Alpaca buying power (all orders execute in USD on Alpaca)
    if (side === 'buy' && alpacaCash < totalCostUsd) {
      const shortfall = totalCostUsd - alpacaCash;
      return res.status(400).json({
        success: false,
        message: 'Insufficient funds to place this order',
        error: {
          type: 'insufficient_funds',
          currency: 'USD',
          required: `$${totalCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          available: `$${alpacaCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          shortfall: `$${shortfall.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          suggestions: [
            `Deposit at least $${shortfall.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} to complete this order`,
            'Try a smaller order amount'
          ]
        }
        // Old detailed response format (commented out):
        // error: {
        //   type: 'insufficient_funds',
        //   required: {
        //     usd: `$${totalCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        //     kes: `KES ${totalCostKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        //   },
        //   available: {
        //     usd: `$${alpacaCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        //     kes: `KES ${(alpacaCash * exchangeRate).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        //   },
        //   shortfall: {
        //     usd: `$${shortfall.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        //     kes: `KES ${(shortfall * exchangeRate).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        //   },
        //   breakdown: {
        //     stockValue: {
        //       usd: `$${orderValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        //       kes: `KES ${orderValueKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        //     },
        //     commission: {
        //       usd: `$${commissionUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (1%)`,
        //       kes: `KES ${commissionKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (1%)`
        //     },
        //     total: {
        //       usd: `$${totalCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        //       kes: `KES ${totalCostKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        //     }
        //   },
        //   suggestions: [
        //     'Deposit more funds to your trading account',
        //     'Reduce the order quantity',
        //     'Use a limit order for better price control'
        //   ]
        // }
      });
    }

    // Create order in database first
    const order = await Order.create({
      user_id: req.user.id,
      symbol: symbol.toUpperCase(),
      side,
      order_type: orderType,
      quantity: parsedQuantity,
      limit_price: limitPrice ? parseFloat(limitPrice) : null,
      stop_price: stopPrice ? parseFloat(stopPrice) : null,
      time_in_force: timeInForce || 'day',
      order_value: orderValue,
      currency: 'USD', // All orders execute in USD on Alpaca
      exchange_rate: exchangeRate,
      status: 'pending',
      fees: {
        commission: {
          rate: COMMISSION_RATE,
          percentage: '1%',
          amountUsd: commissionUsd,
          amountKes: commissionKes
        },
        totalCostUsd: totalCostUsd,
        totalCostKes: totalCostKes,
        stockValueUsd: orderValue,
        stockValueKes: orderValueKes
      },
      metadata: {
        client_order_id: `ORDER_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        estimated_price: estimatedPrice,
        display_currency: currency // What currency user selected for display
      }
    });

    try {

      // Prepare Alpaca order
      const alpacaOrderData = {
        symbol: symbol.toUpperCase(),
        side,
        orderType,
        quantity: parsedQuantity,
        timeInForce: timeInForce || 'day',
        clientOrderId: order.metadata.client_order_id
      };

      if (limitPrice) alpacaOrderData.limitPrice = parseFloat(limitPrice);
      if (stopPrice) alpacaOrderData.stopPrice = parseFloat(stopPrice);

      // Place order with Alpaca
      const alpacaOrder = await alpacaService.createOrder(alpacaOrderData);

      // Update order with Alpaca details
      await order.updateFromAlpaca(alpacaOrder);

      logger.info(`Order created successfully for user ${req.user.id}:`, {
        orderId: order.id,
        alpacaOrderId: alpacaOrder.id,
        symbol,
        side,
        quantity
      });
      audit({ ...reqCtx(req), action: 'order.create', targetType: 'order', targetId: order.id, details: { symbol, side, quantity, orderType, provider: 'alpaca' } });

      // Send notification email
      try {
        await emailService.sendTransactionEmail(user, {
          type: `order_${side}`,
          amount: orderValue,
          currency,
          status: 'submitted',
          reference: order.id,
          metadata: { symbol, quantity }
        });
      } catch (emailError) {
        logger.warn('Failed to send order notification email:', emailError);
      }

      res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        order: {
          id: order.id,
          alpacaOrderId: order.alpaca_order_id,
          symbol: order.symbol,
          side: order.side,
          orderType: order.order_type,
          quantity: order.quantity,
          status: order.status,
          orderValue: order.order_value,
          currency: order.currency,
          exchangeRate: order.exchange_rate,
          fees: order.fees,
          createdAt: order.createdAt
        },
        costBreakdown: {
          stockValue: {
            usd: order.fees.stockValueUsd,
            kes: order.fees.stockValueKes
          },
          commission: {
            usd: order.fees.commission.amountUsd,
            kes: order.fees.commission.amountKes,
            rate: order.fees.commission.percentage
          },
          totalCost: {
            usd: order.fees.totalCostUsd,
            kes: order.fees.totalCostKes
          }
        }
      });

    } catch (alpacaError) {
      // Update order status to failed
      await order.update({
        status: 'rejected',
        rejection_reason: alpacaError.message
      });

      logger.error('Alpaca order creation failed:', alpacaError);

      res.status(400).json({
        success: false,
        message: 'Failed to place order with broker',
        error: alpacaError.message
      });
    }

  } catch (error) {
    logger.error('Create order error:', error.message);
    const msMessage = error.response?.data?.error || error.response?.data?.message;
    const status = error.response?.status || 500;
    res.status(status).json({
      success: false,
      message: msMessage || error.message || 'Server error during order creation'
    });
  }
};

const getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, symbol, side, exchange } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const user = await User.findByPk(req.user.id, { attributes: ['id', 'alpaca_account_id', 'mystocks_sub_account_id'] });

    // MyStocks user (no Alpaca account, or explicit African exchange filter)
    if (!user?.alpaca_account_id || isAfrican(exchange)) {
      // Normalize status: app may send Alpaca-style names (pending_new) — map to MsOrder values
      const msStatusMap = { pending_new: 'PENDING', filled: 'FILLED', canceled: 'CANCELLED', expired: 'EXPIRED' };
      const whereClause = { user_id: req.user.id };
      if (status && status.toLowerCase() !== 'all') {
        whereClause.status = msStatusMap[status.toLowerCase()] || status.toUpperCase();
      }
      if (symbol) whereClause.symbol = symbol.toUpperCase();
      if (side) whereClause.side = side.toUpperCase();
      if (exchange) whereClause.exchange = exchange.toUpperCase();

      const { count, rows: msOrders } = await MsOrder.findAndCountAll({
        where: whereClause,
        order: [['created_at', 'DESC']],
        limit: limitNum,
        offset
      });

      const msStatusToAlpaca = { PENDING: 'pending_new', FILLED: 'filled', CANCELLED: 'canceled', EXPIRED: 'expired' };
      return res.json({
        success: true,
        provider: 'mystocks',
        orders: msOrders.map(o => {
          const usdPrice = parseFloat(o.usd_price || 0);
          const createdAt = o.createdAt || o.created_at || null;
          return {
            id: o.id,
            orderId: o.order_id,
            symbol: o.symbol,
            logo: `/api/v1/assets/logo/${o.symbol}`,
            side: o.side.toLowerCase(),       // Flutter expects lowercase: 'buy' / 'sell'
            quantity: parseFloat(o.quantity),
            price: usdPrice,                  // Flutter: json['price']
            averagePrice: usdPrice,           // Flutter: json['averagePrice']
            limitPrice: usdPrice,
            localPrice: parseFloat(o.local_price || 0),
            usdPrice,
            grossUsd: parseFloat(o.gross_usd || 0),
            feeUsd: parseFloat(o.fee_usd || 0),
            totalCostUsd: parseFloat(o.total_cost_usd || 0),
            currency: o.currency,
            status: msStatusToAlpaca[o.status] || o.status.toLowerCase(),
            exchange: o.exchange,
            filledAt: o.filled_at,
            submittedAt: createdAt,           // Flutter: json['submittedAt'] → date display
            createdAt
          };
        }),
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(count / limitNum),
          totalItems: count,
          itemsPerPage: limitNum
        }
      });
    }

    // Alpaca user
    const whereClause = { user_id: req.user.id };
    if (status && status.toLowerCase() !== 'all') whereClause.status = status;
    if (symbol) whereClause.symbol = symbol.toUpperCase();
    if (side) whereClause.side = side;

    const { count, rows: orders } = await Order.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: limitNum,
      offset
    });

    res.json({
      success: true,
      orders: orders.map(order => ({
        id: order.id,
        alpacaOrderId: order.alpaca_order_id,
        symbol: order.symbol,
        logo: alpacaService.getCompanyLogo(order.symbol),
        side: order.side,
        orderType: order.order_type,
        quantity: order.quantity,
        filledQuantity: order.filled_quantity,
        remainingQuantity: order.remainingQuantity,
        limitPrice: order.limit_price,
        stopPrice: order.stop_price,
        averagePrice: order.average_price,
        status: order.status,
        orderValue: order.order_value,
        totalValue: order.totalValue,
        currency: order.currency,
        exchangeRate: order.exchange_rate,
        submittedAt: order.submitted_at,
        filledAt: order.filled_at,
        createdAt: order.created_at
      })),
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalItems: count,
        itemsPerPage: limitNum
      }
    });
  } catch (error) {
    logger.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const getOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({
      where: {
        id: orderId,
        user_id: req.user.id
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Get latest status from Alpaca if order has Alpaca ID
    if (order.alpaca_order_id && !order.isCompleted) {
      try {
        const alpacaOrder = await alpacaService.getOrder(order.alpaca_order_id);
        await order.updateFromAlpaca(alpacaOrder);
      } catch (alpacaError) {
        logger.warn('Failed to update order from Alpaca:', alpacaError);
      }
    }

    res.json({
      success: true,
      order: {
        id: order.id,
        alpacaOrderId: order.alpaca_order_id,
        symbol: order.symbol,
        logo: alpacaService.getCompanyLogo(order.symbol),
        side: order.side,
        orderType: order.order_type,
        quantity: order.quantity,
        filledQuantity: order.filled_quantity,
        remainingQuantity: order.remainingQuantity,
        limitPrice: order.limit_price,
        stopPrice: order.stop_price,
        averagePrice: order.average_price,
        status: order.status,
        orderValue: order.order_value,
        totalValue: order.totalValue,
        currency: order.currency,
        exchangeRate: order.exchange_rate,
        fees: order.fees,
        submittedAt: order.submitted_at,
        filledAt: order.filled_at,
        cancelledAt: order.cancelled_at,
        rejectionReason: order.rejection_reason,
        metadata: order.metadata,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      }
    });
  } catch (error) {
    logger.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({
      where: {
        id: orderId,
        user_id: req.user.id
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.isCompleted) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed order'
      });
    }

    // Cancel with Alpaca
    if (order.alpaca_order_id) {
      await alpacaService.cancelOrder(order.alpaca_order_id);
    }

    // Update order status
    await order.update({
      status: 'canceled',
      cancelled_at: new Date()
    });

    // Unfreeze funds if it was a buy order
    if (order.side === 'buy') {
      const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
      const walletCurrency = order.currency;
      const amount = order.order_value - (order.filled_quantity * (order.average_price || 0));

      if (amount > 0) {
        await wallet.unfreezeFunds(amount, walletCurrency);
      }
    }

    logger.info(`Order cancelled: ${orderId}`);

    res.json({
      success: true,
      message: 'Order cancelled successfully'
    });
  } catch (error) {
    logger.error('Cancel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during order cancellation'
    });
  }
};

const syncOrdersWithAlpaca = async (req, res) => {
  try {
    // Get all non-completed orders from database
    const pendingOrders = await Order.findAll({
      where: {
        user_id: req.user.id,
        status: {
          [Order.sequelize.Sequelize.Op.notIn]: ['filled', 'canceled', 'expired', 'rejected']
        }
      }
    });

    let syncedCount = 0;

    for (const order of pendingOrders) {
      if (order.alpaca_order_id) {
        try {
          const alpacaOrder = await alpacaService.getOrder(order.alpaca_order_id);
          await order.updateFromAlpaca(alpacaOrder);
          syncedCount++;

          // Handle order completion
          if (alpacaOrder.status === 'filled') {
            await handleOrderFill(order);
          }
        } catch (syncError) {
          logger.warn(`Failed to sync order ${order.id}:`, syncError);
        }
      }
    }

    res.json({
      success: true,
      message: `Synced ${syncedCount} orders with Alpaca`,
      syncedCount
    });
  } catch (error) {
    logger.error('Sync orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during order sync'
    });
  }
};

// Helper function to handle order fills
// Note: Balance is managed by Alpaca directly, we just track transactions for records
const handleOrderFill = async (order) => {
  try {
    const user = await User.findByPk(order.user_id);
    const wallet = await Wallet.findOne({ where: { user_id: order.user_id } });

    // Get commission from order fees (in USD)
    const commissionUsd = order.fees?.commission?.amountUsd || 0;
    const actualStockCost = order.filled_quantity * order.average_price;

    // Create transaction record for the trade (for tracking purposes)
    if (wallet) {
      await Transaction.create({
        wallet_id: wallet.id,
        type: order.side === 'buy' ? 'trade_buy' : 'trade_sell',
        amount: order.side === 'buy' ? -actualStockCost : actualStockCost,
        currency: 'USD',
        status: 'completed',
        reference: `ORDER_${order.id}`,
        alpaca_order_id: order.alpaca_order_id,
        exchange_rate: order.exchange_rate,
        description: `${order.side.toUpperCase()} ${order.filled_quantity} ${order.symbol} @ $${order.average_price}`,
        metadata: {
          symbol: order.symbol,
          quantity: order.filled_quantity,
          price: order.average_price,
          order_id: order.id
        }
      });

      // Create separate transaction record for commission (platform revenue)
      if (commissionUsd > 0) {
        await Transaction.create({
          wallet_id: wallet.id,
          type: 'fee',
          amount: -commissionUsd,
          currency: 'USD',
          status: 'completed',
          reference: `FEE_${order.id}`,
          exchange_rate: order.exchange_rate,
          description: `Platform commission (1%) for ${order.side.toUpperCase()} ${order.symbol}`,
          metadata: {
            order_id: order.id,
            symbol: order.symbol,
            fee_type: 'commission',
            commission_rate: '1%',
            stock_value: actualStockCost,
            commission_amount_usd: commissionUsd
          }
        });

        logger.info(`Commission collected for order ${order.id}: $${commissionUsd.toFixed(2)}`);
        recordRevenue('trade_fee', { userId: order.user_id, amountUsd: commissionUsd, currency: 'USD', reference: `ORDER_${order.id}` });
      }
    }

    // Send notification email
    try {
      await emailService.sendTransactionEmail(user, {
        type: 'order_filled',
        amount: actualStockCost,
        currency: 'USD',
        status: 'completed',
        reference: order.id,
        metadata: {
          symbol: order.symbol,
          quantity: order.filled_quantity,
          price: order.average_price,
          commission: commissionUsd
        }
      });
    } catch (emailError) {
      logger.warn('Failed to send order fill notification email:', emailError);
    }

    logger.info(`Order filled and processed: ${order.id}`);
  } catch (error) {
    logger.error('Handle order fill error:', error);
  }
};

module.exports = {
  createOrder,
  getOrders,
  getOrder,
  cancelOrder,
  syncOrdersWithAlpaca
};