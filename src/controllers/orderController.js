const { Order, User, Wallet, Transaction } = require('../models');
const alpacaService = require('../services/alpacaService');
const exchangeService = require('../services/exchangeService');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

const createOrder = async (req, res) => {
  try {
    const { symbol, side, orderType, quantity, limitPrice, stopPrice, timeInForce, currency } = req.body;

    // Get user and wallet
    const user = await User.findByPk(req.user.id);
    const wallet = await Wallet.findOne({ where: { user_id: req.user.id } });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Get current stock price for order value calculation
    const quote = await alpacaService.getLatestQuote(symbol);
    const estimatedPrice = limitPrice || quote.ap || quote.bp; // Ask/Bid price fallback
    const orderValue = quantity * estimatedPrice;

    let finalOrderValue = orderValue;
    let exchangeRate = 1;
    let requiredBalance;
    let walletCurrency;

    // Handle currency conversion if needed
    if (currency === 'KES') {
      // Convert KES to USD for Alpaca
      const conversion = await exchangeService.convertKEStoUSD(orderValue);
      finalOrderValue = conversion.finalAmount;
      exchangeRate = conversion.rate;
      requiredBalance = orderValue;
      walletCurrency = 'KES';

      // Check KES balance
      if (side === 'buy' && wallet.availableKes < requiredBalance) {
        const shortfall = requiredBalance - wallet.availableKes;
        return res.status(400).json({
          success: false,
          message: `Insufficient KES balance to place this order`,
          error: {
            type: 'insufficient_funds',
            currency: 'KES',
            required: `KES ${requiredBalance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            available: `KES ${wallet.availableKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            shortfall: `KES ${shortfall.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            suggestions: [
              'Deposit more funds to your KES wallet',
              'Reduce the order quantity',
              'Convert USD to KES if you have USD balance',
              'Use a limit order instead of market order for better price control'
            ]
          }
        });
      }
    } else {
      // USD order
      requiredBalance = orderValue;
      walletCurrency = 'USD';

      // Check USD balance
      if (side === 'buy' && wallet.availableUsd < requiredBalance) {
        const shortfall = requiredBalance - wallet.availableUsd;
        return res.status(400).json({
          success: false,
          message: `Insufficient USD balance to place this order`,
          error: {
            type: 'insufficient_funds',
            currency: 'USD',
            required: `$${requiredBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            available: `$${wallet.availableUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            shortfall: `$${shortfall.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            suggestions: [
              'Deposit more funds to your USD wallet',
              'Reduce the order quantity',
              'Convert KES to USD if you have KES balance',
              'Use a limit order instead of market order for better price control'
            ]
          }
        });
      }
    }

    // Create order in database first
    const order = await Order.create({
      user_id: req.user.id,
      symbol: symbol.toUpperCase(),
      side,
      order_type: orderType,
      quantity,
      limit_price: limitPrice,
      stop_price: stopPrice,
      time_in_force: timeInForce || 'day',
      order_value: orderValue,
      currency,
      exchange_rate: exchangeRate,
      status: 'pending',
      metadata: {
        client_order_id: `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        estimated_price: estimatedPrice,
        wallet_currency: walletCurrency
      }
    });

    try {
      // Freeze funds for buy orders
      if (side === 'buy') {
        await wallet.freezeFunds(requiredBalance, walletCurrency);
      }

      // Prepare Alpaca order
      const alpacaOrderData = {
        symbol: symbol.toUpperCase(),
        side,
        orderType,
        quantity,
        timeInForce: timeInForce || 'day',
        clientOrderId: order.metadata.client_order_id
      };

      if (limitPrice) alpacaOrderData.limitPrice = limitPrice;
      if (stopPrice) alpacaOrderData.stopPrice = stopPrice;

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
          createdAt: order.createdAt
        }
      });

    } catch (alpacaError) {
      // Unfreeze funds if Alpaca order failed
      if (side === 'buy') {
        await wallet.unfreezeFunds(requiredBalance, walletCurrency);
      }

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
    logger.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during order creation'
    });
  }
};

const getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, symbol, side } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { user_id: req.user.id };
    if (status) whereClause.status = status;
    if (symbol) whereClause.symbol = symbol.toUpperCase();
    if (side) whereClause.side = side;

    const { count, rows: orders } = await Order.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      orders: orders.map(order => ({
        id: order.id,
        alpacaOrderId: order.alpaca_order_id,
        symbol: order.symbol,
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
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
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
const handleOrderFill = async (order) => {
  try {
    const wallet = await Wallet.findOne({ where: { user_id: order.user_id } });
    const user = await User.findByPk(order.user_id);

    if (order.side === 'buy') {
      // Unfreeze any remaining funds
      const remainingFrozen = order.order_value - (order.filled_quantity * order.average_price);
      if (remainingFrozen > 0) {
        await wallet.unfreezeFunds(remainingFrozen, order.currency);
      }

      // Deduct the actual filled amount
      const actualCost = order.filled_quantity * order.average_price;
      await wallet.updateBalance(actualCost, order.currency, 'subtract');

    } else if (order.side === 'sell') {
      // Credit the sale proceeds
      const saleProceeds = order.filled_quantity * order.average_price;
      await wallet.updateBalance(saleProceeds, order.currency, 'add');
    }

    // Create transaction record
    await Transaction.create({
      wallet_id: wallet.id,
      type: order.side === 'buy' ? 'trade_buy' : 'trade_sell',
      amount: order.side === 'buy' ? -order.filled_quantity * order.average_price : order.filled_quantity * order.average_price,
      currency: order.currency,
      status: 'completed',
      reference: `ORDER_${order.id}`,
      alpaca_order_id: order.alpaca_order_id,
      exchange_rate: order.exchange_rate,
      description: `${order.side.toUpperCase()} ${order.filled_quantity} ${order.symbol} @ ${order.average_price}`,
      metadata: {
        symbol: order.symbol,
        quantity: order.filled_quantity,
        price: order.average_price,
        order_id: order.id
      }
    });

    // Send notification email
    try {
      await emailService.sendTransactionEmail(user, {
        type: 'order_filled',
        amount: order.filled_quantity * order.average_price,
        currency: order.currency,
        status: 'completed',
        reference: order.id,
        metadata: {
          symbol: order.symbol,
          quantity: order.filled_quantity,
          price: order.average_price
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