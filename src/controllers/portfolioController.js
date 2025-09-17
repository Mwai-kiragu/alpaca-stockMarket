const { User, Order } = require('../models');
const alpacaService = require('../services/alpacaService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const getPortfolio = async (req, res) => {
  try {
    // Get Alpaca account information
    const account = await alpacaService.getAccount();

    // Get positions from Alpaca
    const positions = await alpacaService.getPositions();

    // Get user's order history for additional context
    const userOrders = await Order.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 100
    });

    // Calculate portfolio metrics
    const equity = parseFloat(account.equity || 0);
    const dayChange = parseFloat(account.unrealized_pl || 0);
    const dayChangePercent = equity > 0 ? (dayChange / (equity - dayChange)) * 100 : 0;
    const buyingPower = parseFloat(account.buying_power || 0);
    const cash = parseFloat(account.cash || 0);

    // Format positions
    const formattedPositions = positions.map(position => ({
      symbol: position.symbol,
      quantity: parseFloat(position.qty),
      marketValue: parseFloat(position.market_value),
      costBasis: parseFloat(position.cost_basis),
      unrealizedPL: parseFloat(position.unrealized_pl),
      unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100,
      averageEntryPrice: parseFloat(position.avg_entry_price),
      lastDayPrice: parseFloat(position.lastday_price),
      changeToday: parseFloat(position.change_today),
      side: position.side,
      exchange: position.exchange || 'NASDAQ'
    }));

    // Get current exchange rate for KES users
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    res.json({
      success: true,
      portfolio: {
        summary: {
          totalEquity: equity,
          totalEquityKES: equity * exchangeRate,
          dayChange,
          dayChangeKES: dayChange * exchangeRate,
          dayChangePercent: parseFloat(dayChangePercent.toFixed(2)),
          buyingPower,
          buyingPowerKES: buyingPower * exchangeRate,
          cash,
          cashKES: cash * exchangeRate,
          portfolioValue: equity,
          portfolioValueKES: equity * exchangeRate,
          lastUpdated: new Date().toISOString()
        },
        positions: formattedPositions,
        positionsCount: formattedPositions.length,
        exchangeRate,
        account: {
          status: account.status,
          patternDayTrader: account.pattern_day_trader,
          tradingBlocked: account.trading_blocked,
          transfersBlocked: account.transfers_blocked,
          accountBlocked: account.account_blocked,
          createdAt: account.created_at
        }
      }
    });
  } catch (error) {
    logger.error('Get portfolio error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch portfolio data'
    });
  }
};

const getPositions = async (req, res) => {
  try {
    const positions = await alpacaService.getPositions();
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const formattedPositions = await Promise.all(
      positions.map(async (position) => {
        // Get current quote for real-time data
        let currentPrice = parseFloat(position.current_price);
        try {
          const quote = await alpacaService.getLatestQuote(position.symbol);
          currentPrice = quote.ap || quote.bp || currentPrice;
        } catch (quoteError) {
          logger.warn(`Failed to get current quote for ${position.symbol}:`, quoteError);
        }

        const quantity = parseFloat(position.qty);
        const currentValue = quantity * currentPrice;
        const costBasis = parseFloat(position.cost_basis);
        const unrealizedPL = currentValue - costBasis;
        const unrealizedPLPercent = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;

        return {
          symbol: position.symbol,
          quantity,
          side: position.side,
          averageEntryPrice: parseFloat(position.avg_entry_price),
          currentPrice,
          marketValue: currentValue,
          marketValueKES: currentValue * exchangeRate,
          costBasis,
          costBasisKES: costBasis * exchangeRate,
          unrealizedPL,
          unrealizedPLKES: unrealizedPL * exchangeRate,
          unrealizedPLPercent: parseFloat(unrealizedPLPercent.toFixed(2)),
          changeToday: parseFloat(position.change_today || 0),
          changeTodayKES: parseFloat(position.change_today || 0) * exchangeRate,
          lastDayPrice: parseFloat(position.lastday_price || currentPrice),
          exchange: position.exchange || 'NASDAQ',
          assetClass: position.asset_class || 'us_equity'
        };
      })
    );

    // Calculate totals
    const totalValue = formattedPositions.reduce((sum, pos) => sum + pos.marketValue, 0);
    const totalCostBasis = formattedPositions.reduce((sum, pos) => sum + pos.costBasis, 0);
    const totalUnrealizedPL = totalValue - totalCostBasis;
    const totalUnrealizedPLPercent = totalCostBasis > 0 ? (totalUnrealizedPL / totalCostBasis) * 100 : 0;

    res.json({
      success: true,
      positions: formattedPositions,
      summary: {
        totalPositions: formattedPositions.length,
        totalValue,
        totalValueKES: totalValue * exchangeRate,
        totalCostBasis,
        totalCostBasisKES: totalCostBasis * exchangeRate,
        totalUnrealizedPL,
        totalUnrealizedPLKES: totalUnrealizedPL * exchangeRate,
        totalUnrealizedPLPercent: parseFloat(totalUnrealizedPLPercent.toFixed(2)),
        exchangeRate
      }
    });
  } catch (error) {
    logger.error('Get positions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch positions'
    });
  }
};

const getPosition = async (req, res) => {
  try {
    const { symbol } = req.params;

    // Get position from Alpaca
    const positions = await alpacaService.getPositions();
    const position = positions.find(pos => pos.symbol.toUpperCase() === symbol.toUpperCase());

    if (!position) {
      return res.status(404).json({
        success: false,
        message: 'Position not found'
      });
    }

    // Get current quote and historical data
    const [quote, bars] = await Promise.all([
      alpacaService.getLatestQuote(symbol.toUpperCase()),
      alpacaService.getBars(symbol.toUpperCase(), '1Day', null, null, 30)
    ]);

    const currentPrice = quote.ap || quote.bp || parseFloat(position.current_price);
    const quantity = parseFloat(position.qty);
    const costBasis = parseFloat(position.cost_basis);
    const marketValue = quantity * currentPrice;
    const unrealizedPL = marketValue - costBasis;
    const unrealizedPLPercent = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;

    // Get user's trading history for this symbol
    const orders = await Order.findAll({
      where: {
        user_id: req.user.id,
        symbol: symbol.toUpperCase(),
        status: 'filled'
      },
      order: [['created_at', 'DESC']]
    });

    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    res.json({
      success: true,
      position: {
        symbol: position.symbol,
        quantity,
        side: position.side,
        averageEntryPrice: parseFloat(position.avg_entry_price),
        currentPrice,
        marketValue,
        marketValueKES: marketValue * exchangeRate,
        costBasis,
        costBasisKES: costBasis * exchangeRate,
        unrealizedPL,
        unrealizedPLKES: unrealizedPL * exchangeRate,
        unrealizedPLPercent: parseFloat(unrealizedPLPercent.toFixed(2)),
        changeToday: parseFloat(position.change_today || 0),
        changeTodayKES: parseFloat(position.change_today || 0) * exchangeRate,
        lastDayPrice: parseFloat(position.lastday_price || currentPrice),
        exchange: position.exchange || 'NASDAQ',
        assetClass: position.asset_class || 'us_equity'
      },
      quote: {
        askPrice: quote.ap,
        bidPrice: quote.bp,
        askSize: quote.as,
        bidSize: quote.bs,
        timestamp: quote.t
      },
      orders: orders.map(order => ({
        id: order.id,
        side: order.side,
        quantity: order.filled_quantity,
        price: order.average_price,
        value: order.filled_quantity * order.average_price,
        currency: order.currency,
        filledAt: order.filled_at,
        createdAt: order.created_at
      })),
      priceHistory: bars.slice(-7).map(bar => ({
        date: bar.t,
        close: parseFloat(bar.c),
        high: parseFloat(bar.h),
        low: parseFloat(bar.l),
        volume: parseInt(bar.v)
      }))
    });
  } catch (error) {
    logger.error(`Get position error for ${symbol}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch position details'
    });
  }
};

const getPerformance = async (req, res) => {
  try {
    const { period = '1M' } = req.query;

    // Get account information
    const account = await alpacaService.getAccount();

    // Calculate date range based on period
    let startDate;
    const endDate = new Date();

    switch (period) {
      case '1D':
        startDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
        break;
      case '1W':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '1M':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '3M':
        startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1Y':
        startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get user's orders for the period
    const orders = await Order.findAll({
      where: {
        user_id: req.user.id,
        status: 'filled',
        filled_at: {
          [Order.sequelize.Sequelize.Op.between]: [startDate, endDate]
        }
      },
      order: [['filled_at', 'ASC']]
    });

    // Calculate performance metrics
    const totalTrades = orders.length;
    const buyOrders = orders.filter(order => order.side === 'buy');
    const sellOrders = orders.filter(order => order.side === 'sell');

    const totalBought = buyOrders.reduce((sum, order) => sum + (order.filled_quantity * order.average_price), 0);
    const totalSold = sellOrders.reduce((sum, order) => sum + (order.filled_quantity * order.average_price), 0);

    const currentEquity = parseFloat(account.equity || 0);
    const dayChange = parseFloat(account.unrealized_pl || 0);
    const dayChangePercent = currentEquity > 0 ? (dayChange / (currentEquity - dayChange)) * 100 : 0;

    // Group orders by symbol for analysis
    const symbolPerformance = {};
    orders.forEach(order => {
      if (!symbolPerformance[order.symbol]) {
        symbolPerformance[order.symbol] = {
          symbol: order.symbol,
          totalTrades: 0,
          totalVolume: 0,
          totalValue: 0,
          buyQuantity: 0,
          sellQuantity: 0,
          averageBuyPrice: 0,
          averageSellPrice: 0
        };
      }

      const perf = symbolPerformance[order.symbol];
      perf.totalTrades += 1;
      perf.totalVolume += order.filled_quantity;
      perf.totalValue += order.filled_quantity * order.average_price;

      if (order.side === 'buy') {
        perf.buyQuantity += order.filled_quantity;
        perf.averageBuyPrice = ((perf.averageBuyPrice * (perf.buyQuantity - order.filled_quantity)) +
          (order.average_price * order.filled_quantity)) / perf.buyQuantity;
      } else {
        perf.sellQuantity += order.filled_quantity;
        perf.averageSellPrice = ((perf.averageSellPrice * (perf.sellQuantity - order.filled_quantity)) +
          (order.average_price * order.filled_quantity)) / perf.sellQuantity;
      }
    });

    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    res.json({
      success: true,
      performance: {
        period,
        summary: {
          currentEquity,
          currentEquityKES: currentEquity * exchangeRate,
          dayChange,
          dayChangeKES: dayChange * exchangeRate,
          dayChangePercent: parseFloat(dayChangePercent.toFixed(2)),
          totalTrades,
          totalBought,
          totalBoughtKES: totalBought * exchangeRate,
          totalSold,
          totalSoldKES: totalSold * exchangeRate,
          netFlow: totalSold - totalBought,
          netFlowKES: (totalSold - totalBought) * exchangeRate
        },
        trading: {
          buyOrders: buyOrders.length,
          sellOrders: sellOrders.length,
          avgTradeSize: totalTrades > 0 ? (totalBought + totalSold) / totalTrades : 0,
          mostTradedSymbol: Object.keys(symbolPerformance).reduce((a, b) =>
            symbolPerformance[a]?.totalTrades > symbolPerformance[b]?.totalTrades ? a : b,
            Object.keys(symbolPerformance)[0] || null
          )
        },
        bySymbol: Object.values(symbolPerformance).sort((a, b) => b.totalValue - a.totalValue),
        exchangeRate
      }
    });
  } catch (error) {
    logger.error('Get performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance data'
    });
  }
};

const closePosition = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { quantity } = req.body;

    // Get current position
    const positions = await alpacaService.getPositions();
    const position = positions.find(pos => pos.symbol.toUpperCase() === symbol.toUpperCase());

    if (!position) {
      return res.status(404).json({
        success: false,
        message: 'Position not found'
      });
    }

    const positionQty = parseFloat(position.qty);
    const qtyToClose = quantity ? parseFloat(quantity) : positionQty;

    if (qtyToClose > positionQty) {
      return res.status(400).json({
        success: false,
        message: 'Cannot close more shares than owned'
      });
    }

    // Create market order to close position
    const orderData = {
      symbol: symbol.toUpperCase(),
      side: 'sell',
      orderType: 'market',
      quantity: qtyToClose,
      timeInForce: 'day',
      clientOrderId: `CLOSE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    const alpacaOrder = await alpacaService.createOrder(orderData);

    // Create order record in database
    const order = await Order.create({
      user_id: req.user.id,
      alpaca_order_id: alpacaOrder.id,
      symbol: symbol.toUpperCase(),
      side: 'sell',
      order_type: 'market',
      quantity: qtyToClose,
      time_in_force: 'day',
      order_value: qtyToClose * parseFloat(position.current_price || 0),
      currency: 'USD',
      status: alpacaOrder.status,
      metadata: {
        client_order_id: orderData.clientOrderId,
        position_close: true,
        original_position_qty: positionQty
      }
    });

    logger.info(`Position close order placed for ${symbol}: ${qtyToClose} shares`);

    res.json({
      success: true,
      message: 'Position close order placed successfully',
      order: {
        id: order.id,
        alpacaOrderId: alpacaOrder.id,
        symbol: symbol.toUpperCase(),
        quantity: qtyToClose,
        status: alpacaOrder.status,
        orderType: 'market'
      }
    });
  } catch (error) {
    logger.error(`Close position error for ${symbol}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to close position'
    });
  }
};

module.exports = {
  getPortfolio,
  getPositions,
  getPosition,
  getPerformance,
  closePosition
};