const { User, DemoOrder } = require('../models');
const alpacaService = require('../services/alpacaService');
const ms = require('../services/mystocksService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const AFRICAN_EXCHANGES = new Set(['NSE', 'NGX', 'JSE', 'GSE', 'BRVM', 'LUSE', 'EGX', 'BSE', 'SEM']);
const isAfrican = (exchange) => !!exchange && AFRICAN_EXCHANGES.has(exchange.toUpperCase());

// Build positions from demo_orders with live price lookup
const buildDemoPositions = async (userId, exchangeRate) => {
  const orders = await DemoOrder.findAll({ where: { user_id: userId }, order: [['filled_at', 'ASC']] });
  const bySymbol = {};
  for (const o of orders) {
    const sym = o.symbol;
    if (!bySymbol[sym]) bySymbol[sym] = { symbol: sym, exchange: o.exchange || 'NSE', currency: o.currency || 'USD', totalQty: 0, totalCost: 0 };
    const qty = parseFloat(o.quantity);
    const price = parseFloat(o.price_usd || 0);
    if (o.side === 'BUY') { bySymbol[sym].totalQty += qty; bySymbol[sym].totalCost += qty * price; }
    else { bySymbol[sym].totalQty -= qty; bySymbol[sym].totalCost -= qty * price; }
  }

  return Promise.all(
    Object.values(bySymbol).filter(p => p.totalQty > 0.00001).map(async p => {
      let currentPrice = p.totalQty > 0 ? p.totalCost / p.totalQty : 0;
      try {
        if (AFRICAN_EXCHANGES.has(p.exchange?.toUpperCase())) {
          const stocks = await ms.getStocks({ search: p.symbol });
          const stock = Array.isArray(stocks) ? stocks[0] : stocks?.stocks?.[0];
          if (stock?.usdPrice) currentPrice = parseFloat(stock.usdPrice);
          else if (stock?.price) currentPrice = parseFloat(stock.price) / (exchangeRate || 1);
        } else {
          const quote = await alpacaService.getLatestQuote(p.symbol);
          if (quote.ap || quote.bp) currentPrice = parseFloat(quote.ap || quote.bp);
        }
      } catch (_) {}
      const avgEntry = p.totalQty > 0 ? p.totalCost / p.totalQty : 0;
      const marketValue = p.totalQty * currentPrice;
      const costBasis = p.totalQty * avgEntry;
      const unrealizedPL = marketValue - costBasis;
      return {
        symbol: p.symbol, name: p.symbol,
        logo: `/api/v1/assets/logo/${p.symbol}`,
        quantity: p.totalQty, side: 'long',
        averageEntryPrice: parseFloat(avgEntry.toFixed(8)),
        currentPrice, marketValue, marketValueKES: marketValue * (exchangeRate || 1),
        costBasis, costBasisKES: costBasis * (exchangeRate || 1),
        unrealizedPL, unrealizedPLKES: unrealizedPL * (exchangeRate || 1),
        unrealizedPLPercent: costBasis > 0 ? parseFloat(((unrealizedPL / costBasis) * 100).toFixed(2)) : 0,
        exchange: p.exchange, currency: p.currency, provider: 'demo', status: 'open'
      };
    })
  );
};

// GET /api/v1/paper-trading
// Returns demo account summary: balance, P/L, positions count
const getPaperAccount = async (req, res) => {
  try {
    const [user, exchangeRate] = await Promise.all([
      User.findByPk(req.user.id, { attributes: ['id', 'demo_balance', 'account_mode'] }),
      exchangeService.getExchangeRate('USD', 'KES')
    ]);

    const demoBalance = parseFloat(user?.demo_balance || 0);
    const positions = await buildDemoPositions(req.user.id, exchangeRate);
    const marketValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const totalCostBasis = positions.reduce((s, p) => s + p.costBasis, 0);
    const unrealizedPL = marketValue - totalCostBasis;
    const netAssets = demoBalance + marketValue;

    return res.json({
      success: true,
      account: {
        netAssets: parseFloat(netAssets.toFixed(2)),
        netAssetsKES: parseFloat((netAssets * exchangeRate).toFixed(2)),
        cashBalance: parseFloat(demoBalance.toFixed(2)),
        cashBalanceKES: parseFloat((demoBalance * exchangeRate).toFixed(2)),
        marketValue: parseFloat(marketValue.toFixed(2)),
        marketValueKES: parseFloat((marketValue * exchangeRate).toFixed(2)),
        unrealizedPL: parseFloat(unrealizedPL.toFixed(2)),
        unrealizedPLKES: parseFloat((unrealizedPL * exchangeRate).toFixed(2)),
        unrealizedPLPercent: totalCostBasis > 0 ? parseFloat(((unrealizedPL / totalCostBasis) * 100).toFixed(2)) : 0,
        todaysPL: 0,
        positionsCount: positions.length,
        currency: 'USD',
        exchangeRate,
        isDemo: true
      }
    });
  } catch (error) {
    logger.error('Get paper account error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch paper trading account' });
  }
};

// POST /api/v1/paper-trading/trade
// Body: { symbol, side (BUY|SELL), qty, exchange }
const placePaperTrade = async (req, res) => {
  try {
    const { symbol, side, qty: quantity, exchange } = req.body;

    const tradeType = (side || '').toUpperCase();
    if (!['BUY', 'SELL'].includes(tradeType)) {
      return res.status(400).json({ success: false, message: 'side must be BUY or SELL' });
    }

    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) return res.status(400).json({ success: false, message: 'qty must be a positive number' });

    const user = await User.findByPk(req.user.id, { attributes: ['id', 'demo_balance'] });
    const sym = (symbol || '').toUpperCase();
    const demoBalance = parseFloat(user?.demo_balance || 0);

    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    let currentPrice = 0;
    let stockCurrency = 'USD';
    try {
      if (isAfrican(exchange)) {
        const stocks = await ms.getStocks({ search: sym });
        const stock = Array.isArray(stocks) ? stocks[0] : stocks?.stocks?.[0];
        currentPrice = parseFloat(stock?.usdPrice || stock?.price || 0);
        stockCurrency = stock?.currency || 'KES';
      } else {
        const quote = await alpacaService.getLatestQuote(sym);
        currentPrice = parseFloat(quote.ap || quote.bp || 0);
        stockCurrency = 'USD';
      }
    } catch (_) {}

    if (!currentPrice || currentPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Unable to fetch current price for this stock' });
    }

    const gross = Math.round(qty * currentPrice * 100) / 100;
    const fee = Math.round(gross * 0.01 * 100) / 100;

    if (tradeType === 'BUY') {
      const totalCost = gross + fee;
      if (demoBalance < totalCost) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient demo balance',
          available: parseFloat(demoBalance.toFixed(2)),
          required: parseFloat(totalCost.toFixed(2))
        });
      }
      const newBalance = Math.round((demoBalance - totalCost) * 100) / 100;
      await DemoOrder.create({
        user_id: req.user.id, symbol: sym, side: 'BUY', quantity: qty,
        price_usd: currentPrice, gross_usd: gross, fee_usd: fee, total_cost_usd: totalCost,
        currency: stockCurrency, exchange: exchange?.toUpperCase() || 'NSE',
        balance_after: newBalance, status: 'FILLED', filled_at: new Date()
      });
      await user.update({ demo_balance: newBalance });
      logger.info(`Paper trade BUY: user=${req.user.id} sym=${sym} qty=${qty} price=${currentPrice} newBalance=${newBalance}`);
      return res.status(201).json({
        success: true, provider: 'demo',
        order: {
          symbol: sym, side: 'BUY', quantity: qty,
          price: currentPrice, gross, fee, totalCost,
          balanceAfter: newBalance,
          balanceAfterKES: parseFloat((newBalance / exchangeRate).toFixed(2))
        }
      });
    } else {
      const existingOrders = await DemoOrder.findAll({ where: { user_id: req.user.id, symbol: sym } });
      let netQty = 0;
      for (const o of existingOrders) {
        if (o.side === 'BUY') netQty += parseFloat(o.quantity);
        else netQty -= parseFloat(o.quantity);
      }
      if (netQty < qty) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient shares',
          available: parseFloat(netQty.toFixed(6)),
          required: qty
        });
      }
      const proceeds = Math.round((gross - fee) * 100) / 100;
      const newBalance = Math.round((demoBalance + proceeds) * 100) / 100;
      await DemoOrder.create({
        user_id: req.user.id, symbol: sym, side: 'SELL', quantity: qty,
        price_usd: currentPrice, gross_usd: gross, fee_usd: fee, total_cost_usd: proceeds,
        currency: stockCurrency, exchange: exchange?.toUpperCase() || 'NSE',
        balance_after: newBalance, status: 'FILLED', filled_at: new Date()
      });
      await user.update({ demo_balance: newBalance });
      logger.info(`Paper trade SELL: user=${req.user.id} sym=${sym} qty=${qty} price=${currentPrice} newBalance=${newBalance}`);
      return res.status(201).json({
        success: true, provider: 'demo',
        order: {
          symbol: sym, side: 'SELL', quantity: qty,
          price: currentPrice, gross, fee, proceeds,
          balanceAfter: newBalance,
          balanceAfterKES: parseFloat((newBalance / exchangeRate).toFixed(2))
        }
      });
    }
  } catch (error) {
    logger.error('Place paper trade error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to place paper trade' });
  }
};

// GET /api/v1/paper-trading/orders
const getPaperOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, symbol, side } = req.query;
    const whereClause = { user_id: req.user.id };
    if (symbol) whereClause.symbol = symbol.toUpperCase();
    if (side) whereClause.side = side.toUpperCase();

    const orders = await DemoOrder.findAll({
      where: whereClause,
      order: [['filled_at', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    return res.json({
      success: true, provider: 'demo',
      orders: orders.map(o => ({
        id: o.id, symbol: o.symbol, side: o.side,
        quantity: parseFloat(o.quantity),
        price: parseFloat(o.price_usd || 0),
        gross: parseFloat(o.gross_usd || 0),
        fee: parseFloat(o.fee_usd || 0),
        totalCost: parseFloat(o.total_cost_usd || 0),
        balanceAfter: parseFloat(o.balance_after || 0),
        exchange: o.exchange, currency: o.currency,
        status: o.status, filledAt: o.filled_at
      }))
    });
  } catch (error) {
    logger.error('Get paper orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch paper orders' });
  }
};

// GET /api/v1/paper-trading/positions
const getPaperPositions = async (req, res) => {
  try {
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');
    const positions = await buildDemoPositions(req.user.id, exchangeRate);
    const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const totalCostBasis = positions.reduce((s, p) => s + p.costBasis, 0);
    const totalUnrealizedPL = totalValue - totalCostBasis;

    return res.json({
      success: true, provider: 'demo', positions,
      summary: {
        totalPositions: positions.length,
        totalValue: parseFloat(totalValue.toFixed(2)),
        totalValueKES: parseFloat((totalValue * exchangeRate).toFixed(2)),
        totalCostBasis: parseFloat(totalCostBasis.toFixed(2)),
        totalUnrealizedPL: parseFloat(totalUnrealizedPL.toFixed(2)),
        totalUnrealizedPLPercent: totalCostBasis > 0 ? parseFloat(((totalUnrealizedPL / totalCostBasis) * 100).toFixed(2)) : 0,
        exchangeRate
      }
    });
  } catch (error) {
    logger.error('Get paper positions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch paper positions' });
  }
};

// GET /api/v1/paper-trading/portfolio
const getPaperPortfolio = async (req, res) => {
  try {
    const [user, exchangeRate] = await Promise.all([
      User.findByPk(req.user.id, { attributes: ['id', 'demo_balance'] }),
      exchangeService.getExchangeRate('USD', 'KES')
    ]);

    const demoBalance = parseFloat(user?.demo_balance || 0);
    const positions = await buildDemoPositions(req.user.id, exchangeRate);
    const marketValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const totalEquity = demoBalance + marketValue;

    return res.json({
      success: true, provider: 'demo',
      portfolio: {
        summary: {
          totalEquity: parseFloat(totalEquity.toFixed(2)),
          totalEquityKES: parseFloat((totalEquity * exchangeRate).toFixed(2)),
          cash: parseFloat(demoBalance.toFixed(2)),
          cashKES: parseFloat((demoBalance * exchangeRate).toFixed(2)),
          marketValue: parseFloat(marketValue.toFixed(2)),
          marketValueKES: parseFloat((marketValue * exchangeRate).toFixed(2)),
          buyingPower: parseFloat(demoBalance.toFixed(2)),
          buyingPowerKES: parseFloat((demoBalance * exchangeRate).toFixed(2)),
          dayChange: 0, dayChangeKES: 0, dayChangePercent: 0,
          lastUpdated: new Date().toISOString()
        },
        positions,
        positionsCount: positions.length,
        exchangeRate,
        isDemo: true
      }
    });
  } catch (error) {
    logger.error('Get paper portfolio error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch paper portfolio' });
  }
};

// GET /api/v1/paper-trading/allocation
const getPaperAllocation = async (req, res) => {
  try {
    const [user, exchangeRate] = await Promise.all([
      User.findByPk(req.user.id, { attributes: ['id', 'demo_balance'] }),
      exchangeService.getExchangeRate('USD', 'KES')
    ]);

    const demoBalance = parseFloat(user?.demo_balance || 0);
    const positions = await buildDemoPositions(req.user.id, exchangeRate);
    const marketValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const portfolioValue = demoBalance + marketValue;

    const byStock = positions.map(p => ({
      symbol: p.symbol, name: p.symbol,
      value: parseFloat(p.marketValue.toFixed(2)),
      valueKES: parseFloat(p.marketValueKES.toFixed(2)),
      percentage: portfolioValue > 0 ? parseFloat(((p.marketValue / portfolioValue) * 100).toFixed(2)) : 0,
      quantity: p.quantity, currentPrice: p.currentPrice,
      unrealizedPL: parseFloat(p.unrealizedPL.toFixed(2)),
      unrealizedPLPercent: p.unrealizedPLPercent,
      exchange: p.exchange
    })).sort((a, b) => b.value - a.value);

    const byExchange = Object.values(
      positions.reduce((acc, p) => {
        const exch = p.exchange || 'NSE';
        if (!acc[exch]) acc[exch] = { name: exch, value: 0, valueKES: 0, count: 0 };
        acc[exch].value += p.marketValue;
        acc[exch].valueKES += p.marketValueKES;
        acc[exch].count++;
        return acc;
      }, {})
    ).map(e => ({
      ...e,
      value: parseFloat(e.value.toFixed(2)),
      valueKES: parseFloat(e.valueKES.toFixed(2)),
      percentage: portfolioValue > 0 ? parseFloat(((e.value / portfolioValue) * 100).toFixed(2)) : 0
    }));

    const cashEntry = demoBalance > 0 ? [{
      name: 'Demo Cash',
      value: parseFloat(demoBalance.toFixed(2)),
      valueKES: parseFloat((demoBalance * exchangeRate).toFixed(2)),
      percentage: portfolioValue > 0 ? parseFloat(((demoBalance / portfolioValue) * 100).toFixed(2)) : 100,
      count: 0, stocks: []
    }] : [];

    return res.json({
      success: true, provider: 'demo',
      allocation: {
        byAssetClass: [
          ...cashEntry,
          ...(marketValue > 0 ? [{
            name: 'Stocks',
            value: parseFloat(marketValue.toFixed(2)),
            valueKES: parseFloat((marketValue * exchangeRate).toFixed(2)),
            percentage: portfolioValue > 0 ? parseFloat(((marketValue / portfolioValue) * 100).toFixed(2)) : 0,
            count: positions.length,
            stocks: byStock.map(s => s.symbol)
          }] : [])
        ],
        bySector: [],
        byStock,
        byExchange
      },
      summary: {
        portfolioValue: parseFloat(portfolioValue.toFixed(2)),
        portfolioValueKES: parseFloat((portfolioValue * exchangeRate).toFixed(2)),
        cash: parseFloat(demoBalance.toFixed(2)),
        cashKES: parseFloat((demoBalance * exchangeRate).toFixed(2)),
        marketValue: parseFloat(marketValue.toFixed(2)),
        marketValueKES: parseFloat((marketValue * exchangeRate).toFixed(2)),
        totalPositions: positions.length,
        exchangeRate
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Get paper allocation error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch paper allocation' });
  }
};

// GET /api/v1/paper-trading/performance
const getPaperPerformance = async (req, res) => {
  try {
    const { period = '1M' } = req.query;
    const [user, exchangeRate] = await Promise.all([
      User.findByPk(req.user.id, { attributes: ['id', 'demo_balance'] }),
      exchangeService.getExchangeRate('USD', 'KES')
    ]);

    let startDate;
    const endDate = new Date();
    switch (period) {
      case '1D': startDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); break;
      case '1W': startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); break;
      case '3M': startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); break;
      case '1Y': startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); break;
      default:   startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    const demoBalance = parseFloat(user?.demo_balance || 0);
    const demoOrders = await DemoOrder.findAll({
      where: {
        user_id: req.user.id,
        filled_at: { [DemoOrder.sequelize.Sequelize.Op.between]: [startDate, endDate] }
      },
      order: [['filled_at', 'ASC']]
    });

    const buys = demoOrders.filter(o => o.side === 'BUY');
    const sells = demoOrders.filter(o => o.side === 'SELL');
    const totalBought = buys.reduce((s, o) => s + parseFloat(o.gross_usd || 0), 0);
    const totalSold = sells.reduce((s, o) => s + parseFloat(o.gross_usd || 0), 0);

    const symbolMap = {};
    demoOrders.forEach(o => {
      if (!symbolMap[o.symbol]) symbolMap[o.symbol] = { symbol: o.symbol, totalTrades: 0, totalVolume: 0, totalValue: 0 };
      symbolMap[o.symbol].totalTrades++;
      symbolMap[o.symbol].totalVolume += parseFloat(o.quantity);
      symbolMap[o.symbol].totalValue += parseFloat(o.gross_usd || 0);
    });

    return res.json({
      success: true, provider: 'demo',
      performance: {
        period,
        summary: {
          currentEquity: demoBalance,
          currentEquityKES: parseFloat((demoBalance * exchangeRate).toFixed(2)),
          dayChange: 0, dayChangeKES: 0, dayChangePercent: 0,
          totalTrades: demoOrders.length,
          totalBought: parseFloat(totalBought.toFixed(2)),
          totalBoughtKES: parseFloat((totalBought * exchangeRate).toFixed(2)),
          totalSold: parseFloat(totalSold.toFixed(2)),
          totalSoldKES: parseFloat((totalSold * exchangeRate).toFixed(2)),
          netFlow: parseFloat((totalSold - totalBought).toFixed(2)),
          netFlowKES: parseFloat(((totalSold - totalBought) * exchangeRate).toFixed(2))
        },
        trading: {
          buyOrders: buys.length, sellOrders: sells.length,
          avgTradeSize: demoOrders.length > 0 ? parseFloat(((totalBought + totalSold) / demoOrders.length).toFixed(2)) : 0,
          mostTradedSymbol: Object.keys(symbolMap).reduce((a, b) =>
            (symbolMap[a]?.totalTrades > symbolMap[b]?.totalTrades ? a : b),
            Object.keys(symbolMap)[0] || null
          )
        },
        bySymbol: Object.values(symbolMap).sort((a, b) => b.totalValue - a.totalValue),
        exchangeRate
      }
    });
  } catch (error) {
    logger.error('Get paper performance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch paper performance' });
  }
};

module.exports = {
  getPaperAccount,
  placePaperTrade,
  getPaperOrders,
  getPaperPositions,
  getPaperPortfolio,
  getPaperAllocation,
  getPaperPerformance
};
