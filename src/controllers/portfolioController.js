const { User, Order, Wallet, MsOrder, DemoOrder } = require('../models');
const alpacaService = require('../services/alpacaService');
const ms = require('../services/mystocksService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const AFRICAN_EXCHANGES = new Set(['NSE', 'NGX', 'JSE', 'GSE', 'BRVM', 'LUSE', 'EGX', 'BSE', 'SEM']);

// Aggregate DemoOrder records into positions with current prices
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
        quantity: p.totalQty, side: 'long', averageEntryPrice: parseFloat(avgEntry.toFixed(8)),
        currentPrice, marketValue, marketValueKES: marketValue * (exchangeRate || 1),
        costBasis, costBasisKES: costBasis * (exchangeRate || 1),
        unrealizedPL, unrealizedPLKES: unrealizedPL * (exchangeRate || 1),
        unrealizedPLPercent: costBasis > 0 ? parseFloat(((unrealizedPL / costBasis) * 100).toFixed(2)) : 0,
        exchange: p.exchange, currency: p.currency,
        provider: 'demo', status: 'open'
      };
    })
  );
};

const getPortfolio = async (req, res) => {
  try {
    // Check if user has an Alpaca account
    const user = await User.findByPk(req.user.id);

    // Get local wallet balance
    let wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      wallet = { kes_balance: 0, usd_balance: 0, frozen_kes: 0, frozen_usd: 0 };
    }

    const localKesBalance = parseFloat(wallet.kes_balance) || 0;
    const localUsdBalance = parseFloat(wallet.usd_balance) || 0;

    // Get exchange rate early - needed for both cases
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    if (user?.account_mode === 'demo') {
      const demoBalance = parseFloat(user.demo_balance || 0);
      const positions = await buildDemoPositions(req.user.id, exchangeRate);
      const holdingsValue = positions.reduce((s, p) => s + p.marketValue, 0);
      const totalEquity = demoBalance + holdingsValue;
      return res.json({
        success: true, provider: 'demo',
        portfolio: {
          summary: {
            totalEquity, totalEquityKES: totalEquity * exchangeRate,
            dayChange: 0, dayChangeKES: 0, dayChangePercent: 0,
            buyingPower: demoBalance, buyingPowerKES: demoBalance * exchangeRate,
            cash: demoBalance, cashKES: demoBalance * exchangeRate,
            portfolioValue: totalEquity, portfolioValueKES: totalEquity * exchangeRate,
            lastUpdated: new Date().toISOString()
          },
          positions, positionsCount: positions.length, exchangeRate,
          account: null, demoBalance,
          isDemo: true
        }
      });
    }

    if (!user || !user.alpaca_account_id) {
      // African-only user — fetch MyStocks portfolio + wallet
      let msPortfolio = null;
      let msUsdBalance = parseFloat(user?.mystocks_wallet_balance || 0);

      try {
        if (user?.mystocks_sub_account_id) {
          const [portfolioData, walletData] = await Promise.allSettled([
            ms.getPortfolio(user.mystocks_sub_account_id),
            ms.getWallet(user.mystocks_sub_account_id)
          ]);
          if (portfolioData.status === 'fulfilled') msPortfolio = portfolioData.value;
          if (walletData.status === 'fulfilled') {
            const apiBalance = parseFloat(walletData.value?.wallet?.balance || walletData.value?.balance || 0);
            if (apiBalance > 0) msUsdBalance = apiBalance;
          }
        }
      } catch (_) {}

      const positions = [];
      if (msPortfolio) {
        const holdings = Array.isArray(msPortfolio) ? msPortfolio
          : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
          : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];

        holdings.forEach(h => {
          const qty = parseFloat(h.quantity || h.qty || 0);
          const price = parseFloat(h.currentPrice || h.price || h.localPrice || 0);
          const cost = parseFloat(h.averageCost || h.avgCost || price);
          const marketValue = qty * price;
          const unrealizedPL = marketValue - (qty * cost);
          positions.push({
            symbol: h.symbol,
            name: h.name || h.symbol,
            qty,
            avgEntryPrice: cost,
            currentPrice: price,
            marketValue,
            marketValueKES: marketValue * exchangeRate,
            unrealizedPL,
            unrealizedPLKES: unrealizedPL * exchangeRate,
            unrealizedPLPC: cost > 0 ? (unrealizedPL / (qty * cost)) * 100 : 0,
            exchange: h.exchange || 'NSE',
            currency: h.currency || 'KES',
            provider: 'mystocks'
          });
        });
      }

      const holdingsValue = positions.reduce((s, p) => s + p.marketValue, 0);
      const totalEquity = msUsdBalance + holdingsValue + localUsdBalance + (localKesBalance / exchangeRate);
      const totalEquityKES = totalEquity * exchangeRate;

      return res.json({
        success: true,
        provider: 'mystocks',
        portfolio: {
          summary: {
            totalEquity,
            totalEquityKES,
            dayChange: 0,
            dayChangeKES: 0,
            dayChangePercent: 0,
            buyingPower: msUsdBalance,
            buyingPowerKES: msUsdBalance * exchangeRate,
            cash: msUsdBalance,
            cashKES: msUsdBalance * exchangeRate,
            portfolioValue: totalEquity,
            portfolioValueKES: totalEquityKES,
            lastUpdated: new Date().toISOString()
          },
          positions,
          positionsCount: positions.length,
          exchangeRate,
          account: null,
          localWallet: { kesBalance: localKesBalance, usdBalance: localUsdBalance },
          myStocksWallet: { balance: msUsdBalance, currency: 'USD' }
        }
      });
    }

    // Get Alpaca account information for this specific user
    const account = await alpacaService.getAccount(user.alpaca_account_id);

    // Get positions from Alpaca for this specific user
    const positions = await alpacaService.getPositions(user.alpaca_account_id);

    // Get user's order history for additional context
    const userOrders = await Order.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 100
    });

    // Calculate portfolio metrics from Alpaca
    const alpacaEquity = parseFloat(account.equity || 0);
    const dayChange = parseFloat(account.unrealized_pl || 0);
    const dayChangePercent = alpacaEquity > 0 ? (dayChange / (alpacaEquity - dayChange)) * 100 : 0;
    const alpacaBuyingPower = parseFloat(account.buying_power || 0);
    const alpacaCash = parseFloat(account.cash || 0);

    // Convert local wallet to USD and combine with Alpaca
    const localCashUsd = localUsdBalance + (localKesBalance / exchangeRate);

    // Total values = Alpaca + Local Wallet
    const totalCash = alpacaCash + localCashUsd;
    const totalEquity = alpacaEquity + localCashUsd;
    const totalBuyingPower = alpacaBuyingPower + localCashUsd;

    // Format positions
    const formattedPositions = positions.map(position => {
      // Check if there are any pending orders for this symbol
      const hasPendingOrders = userOrders.some(order =>
        order.symbol.toUpperCase() === position.symbol.toUpperCase() &&
        ['pending', 'new', 'partially_filled', 'accepted', 'pending_new',
         'accepted_for_bidding', 'pending_cancel', 'pending_replace'].includes(order.status)
      );

      return {
        symbol: position.symbol,
        logo: alpacaService.getCompanyLogo(position.symbol),
        quantity: parseFloat(position.qty),
        marketValue: parseFloat(position.market_value),
        costBasis: parseFloat(position.cost_basis),
        unrealizedPL: parseFloat(position.unrealized_pl),
        unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100,
        averageEntryPrice: parseFloat(position.avg_entry_price),
        lastDayPrice: parseFloat(position.lastday_price),
        changeToday: parseFloat(position.change_today),
        side: position.side,
        exchange: position.exchange || 'NASDAQ',
        assetClass: position.asset_class || 'us_equity',
        status: hasPendingOrders ? 'pending' : 'open'
      };
    });

    res.json({
      success: true,
      portfolio: {
        summary: {
          totalEquity,
          totalEquityKES: totalEquity * exchangeRate,
          dayChange,
          dayChangeKES: dayChange * exchangeRate,
          dayChangePercent: parseFloat(dayChangePercent.toFixed(2)),
          buyingPower: totalBuyingPower,
          buyingPowerKES: totalBuyingPower * exchangeRate,
          cash: totalCash,
          cashKES: totalCash * exchangeRate,
          portfolioValue: totalEquity,
          portfolioValueKES: totalEquity * exchangeRate,
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
        },
        localWallet: {
          kesBalance: localKesBalance,
          usdBalance: localUsdBalance,
          totalUsd: localCashUsd
        },
        mystocks: await (async () => {
          if (!user.mystocks_sub_account_id) return null;
          try {
            return await ms.getPortfolio(user.mystocks_sub_account_id);
          } catch (e) {
            logger.warn('MyStocks portfolio fetch error:', e.message);
            return null;
          }
        })()
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
    const { market } = req.query;

    // Check if user has an Alpaca account
    const user = await User.findByPk(req.user.id);
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    if (user?.account_mode === 'demo') {
      const positions = await buildDemoPositions(req.user.id, exchangeRate);
      const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
      const totalCostBasis = positions.reduce((s, p) => s + p.costBasis, 0);
      const totalUnrealizedPL = totalValue - totalCostBasis;
      return res.json({
        success: true, provider: 'demo', positions,
        summary: {
          totalPositions: positions.length,
          totalValue: parseFloat(totalValue.toFixed(2)), totalValueKES: parseFloat((totalValue * exchangeRate).toFixed(2)),
          totalCostBasis: parseFloat(totalCostBasis.toFixed(2)), totalCostBasisKES: parseFloat((totalCostBasis * exchangeRate).toFixed(2)),
          totalUnrealizedPL: parseFloat(totalUnrealizedPL.toFixed(2)), totalUnrealizedPLKES: parseFloat((totalUnrealizedPL * exchangeRate).toFixed(2)),
          totalUnrealizedPLPercent: totalCostBasis > 0 ? parseFloat(((totalUnrealizedPL / totalCostBasis) * 100).toFixed(2)) : 0,
          exchangeRate
        }
      });
    }

    if (!user || !user.alpaca_account_id) {
      // Try live MyStocks portfolio first, fall back to locally saved ms_orders
      let positions = [];
      try {
        if (user?.mystocks_sub_account_id) {
          const msPortfolio = await ms.getPortfolio(user.mystocks_sub_account_id);
          const holdings = Array.isArray(msPortfolio) ? msPortfolio
            : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
            : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];
          if (holdings.length > 0) {
            positions = holdings.map(h => {
              const qty = parseFloat(h.quantity || h.qty || 0);
              const price = parseFloat(h.currentPrice || h.price || 0);
              const cost = parseFloat(h.averageCost || h.avgCost || price);
              const marketValue = qty * price;
              const costBasis = qty * cost;
              const unrealizedPL = marketValue - costBasis;
              return {
                symbol: h.symbol, name: h.name || h.symbol,
                logo: `/api/v1/assets/logo/${h.symbol}`,
                quantity: qty, side: 'long', averageEntryPrice: cost,
                currentPrice: price, marketValue,
                marketValueKES: marketValue * exchangeRate,
                costBasis, costBasisKES: costBasis * exchangeRate,
                unrealizedPL, unrealizedPLKES: unrealizedPL * exchangeRate,
                unrealizedPLPercent: costBasis > 0 ? parseFloat(((unrealizedPL / costBasis) * 100).toFixed(2)) : 0,
                exchange: h.exchange || 'NSE', currency: h.currency || 'KES',
                provider: 'mystocks', status: 'open'
              };
            });
          }
        }
      } catch (_) {}

      // Fall back to locally saved trades if portfolio API returned nothing
      if (positions.length === 0) {
        const msOrders = await MsOrder.findAll({ where: { user_id: req.user.id }, order: [['filled_at', 'ASC']] });
        const bySymbol = {};
        for (const o of msOrders) {
          const sym = o.symbol;
          if (!bySymbol[sym]) bySymbol[sym] = { symbol: sym, exchange: o.exchange || 'NSE', currency: o.currency || 'KES', totalQty: 0, totalCost: 0 };
          const qty = parseFloat(o.quantity);
          const price = parseFloat(o.usd_price || o.local_price || 0);
          if (o.side === 'BUY') { bySymbol[sym].totalQty += qty; bySymbol[sym].totalCost += qty * price; }
          else { bySymbol[sym].totalQty -= qty; bySymbol[sym].totalCost -= qty * price; }
        }
        positions = await Promise.all(
          Object.values(bySymbol).filter(p => p.totalQty > 0.0001).map(async p => {
            let currentPrice = p.totalQty > 0 ? p.totalCost / p.totalQty : 0;
            try {
              const stocks = await ms.getStocks({ search: p.symbol });
              const stock = Array.isArray(stocks) ? stocks[0] : stocks?.stocks?.[0];
              if (stock?.usdPrice) currentPrice = parseFloat(stock.usdPrice);
              else if (stock?.price) currentPrice = parseFloat(stock.price) / exchangeRate;
            } catch (_) {}
            const avgEntry = p.totalQty > 0 ? p.totalCost / p.totalQty : 0;
            const marketValue = p.totalQty * currentPrice;
            const costBasis = p.totalQty * avgEntry;
            const unrealizedPL = marketValue - costBasis;
            return {
              symbol: p.symbol, name: p.symbol,
              logo: `/api/v1/assets/logo/${p.symbol}`,
              quantity: p.totalQty, side: 'long', averageEntryPrice: avgEntry,
              currentPrice, marketValue, marketValueKES: marketValue * exchangeRate,
              costBasis, costBasisKES: costBasis * exchangeRate,
              unrealizedPL, unrealizedPLKES: unrealizedPL * exchangeRate,
              unrealizedPLPercent: costBasis > 0 ? parseFloat(((unrealizedPL / costBasis) * 100).toFixed(2)) : 0,
              exchange: p.exchange, currency: p.currency,
              provider: 'mystocks', status: 'open'
            };
          })
        );
      }

      const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
      const totalCostBasis = positions.reduce((s, p) => s + p.costBasis, 0);
      const totalUnrealizedPL = totalValue - totalCostBasis;

      return res.json({
        success: true,
        provider: 'mystocks',
        positions,
        summary: {
          totalPositions: positions.length,
          totalValue: parseFloat(totalValue.toFixed(2)),
          totalValueKES: parseFloat((totalValue * exchangeRate).toFixed(2)),
          totalCostBasis: parseFloat(totalCostBasis.toFixed(2)),
          totalCostBasisKES: parseFloat((totalCostBasis * exchangeRate).toFixed(2)),
          totalUnrealizedPL: parseFloat(totalUnrealizedPL.toFixed(2)),
          totalUnrealizedPLKES: parseFloat((totalUnrealizedPL * exchangeRate).toFixed(2)),
          totalUnrealizedPLPercent: totalCostBasis > 0 ? parseFloat(((totalUnrealizedPL / totalCostBasis) * 100).toFixed(2)) : 0,
          exchangeRate
        }
      });
    }

    // Get positions for this specific user's Alpaca account
    const positions = await alpacaService.getPositions(user.alpaca_account_id);

    // Get all user orders to check for pending orders
    const userOrders = await Order.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']]
    });

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

        // Check if there are any pending orders for this symbol
        const hasPendingOrders = userOrders.some(order =>
          order.symbol.toUpperCase() === position.symbol.toUpperCase() &&
          ['pending', 'new', 'partially_filled', 'accepted', 'pending_new',
           'accepted_for_bidding', 'pending_cancel', 'pending_replace'].includes(order.status)
        );

        return {
          symbol: position.symbol,
          logo: alpacaService.getCompanyLogo(position.symbol),
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
          assetClass: position.asset_class || 'us_equity',
          status: hasPendingOrders ? 'pending' : 'open'
        };
      })
    );

    let filteredPositions = formattedPositions;
    if (market) {
      const marketMap = {
        'us_equity': ['us_equity', 'us_stock'],
        'us_stock': ['us_equity', 'us_stock'],
        'ke_stock': ['ke_equity', 'ke_stock']
      };

      const allowedMarkets = marketMap[market.toLowerCase()] || [market.toLowerCase()];
      filteredPositions = formattedPositions.filter(pos =>
        allowedMarkets.includes(pos.assetClass.toLowerCase())
      );
    }

    // Calculate totals based on filtered positions
    const totalValue = filteredPositions.reduce((sum, pos) => sum + pos.marketValue, 0);
    const totalCostBasis = filteredPositions.reduce((sum, pos) => sum + pos.costBasis, 0);
    const totalUnrealizedPL = totalValue - totalCostBasis;
    const totalUnrealizedPLPercent = totalCostBasis > 0 ? (totalUnrealizedPL / totalCostBasis) * 100 : 0;

    res.json({
      success: true,
      positions: filteredPositions,
      summary: {
        totalPositions: filteredPositions.length,
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

    // Check if user has an Alpaca account
    const user = await User.findByPk(req.user.id);
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    if (!user || !user.alpaca_account_id) {
      // Try MyStocks portfolio for African users
      try {
        if (user?.mystocks_sub_account_id) {
          const msPortfolio = await ms.getPortfolio(user.mystocks_sub_account_id);
          const holdings = Array.isArray(msPortfolio) ? msPortfolio
            : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
            : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];
          const holding = holdings.find(h => h.symbol?.toUpperCase() === symbol.toUpperCase());
          if (holding) {
            const qty = parseFloat(holding.quantity || holding.qty || 0);
            const price = parseFloat(holding.currentPrice || holding.price || 0);
            const cost = parseFloat(holding.averageCost || holding.avgCost || price);
            const marketValue = qty * price;
            const costBasis = qty * cost;
            const unrealizedPL = marketValue - costBasis;
            return res.json({
              success: true,
              provider: 'mystocks',
              position: {
                symbol: holding.symbol,
                quantity: qty,
                side: 'long',
                averageEntryPrice: cost,
                currentPrice: price,
                marketValue,
                marketValueKES: marketValue * exchangeRate,
                costBasis,
                costBasisKES: costBasis * exchangeRate,
                unrealizedPL,
                unrealizedPLKES: unrealizedPL * exchangeRate,
                unrealizedPLPercent: costBasis > 0 ? parseFloat(((unrealizedPL / costBasis) * 100).toFixed(2)) : 0,
                exchange: holding.exchange || 'NSE',
                currency: holding.currency || 'KES'
              },
              exchangeRate
            });
          }
        }
      } catch (_) {}
      return res.status(404).json({ success: false, message: 'Position not found' });
    }

    // Get position from Alpaca for this specific user
    const positions = await alpacaService.getPositions(user.alpaca_account_id);
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

    const [user, exchangeRate] = await Promise.all([
      User.findByPk(req.user.id, { attributes: ['id', 'alpaca_account_id', 'mystocks_wallet_balance'] }),
      exchangeService.getExchangeRate('USD', 'KES')
    ]);

    // Calculate date range based on period
    let startDate;
    const endDate = new Date();

    switch (period) {
      case '1D': startDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); break;
      case '1W': startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); break;
      case '1M': startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); break;
      case '3M': startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); break;
      case '1Y': startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); break;
      default:   startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    if (user?.account_mode === 'demo') {
      const demoBalance = parseFloat(user?.demo_balance || 0);
      const demoOrders = await DemoOrder.findAll({
        where: { user_id: req.user.id, filled_at: { [DemoOrder.sequelize.Sequelize.Op.between]: [startDate, endDate] } },
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
            currentEquity: demoBalance, currentEquityKES: demoBalance * exchangeRate,
            dayChange: 0, dayChangeKES: 0, dayChangePercent: 0,
            totalTrades: demoOrders.length,
            totalBought, totalBoughtKES: totalBought * exchangeRate,
            totalSold, totalSoldKES: totalSold * exchangeRate,
            netFlow: totalSold - totalBought, netFlowKES: (totalSold - totalBought) * exchangeRate
          },
          trading: {
            buyOrders: buys.length, sellOrders: sells.length,
            avgTradeSize: demoOrders.length > 0 ? (totalBought + totalSold) / demoOrders.length : 0,
            mostTradedSymbol: Object.keys(symbolMap).reduce((a, b) => (symbolMap[a]?.totalTrades > symbolMap[b]?.totalTrades ? a : b), Object.keys(symbolMap)[0] || null)
          },
          bySymbol: Object.values(symbolMap).sort((a, b) => b.totalValue - a.totalValue),
          exchangeRate
        }
      });
    }

    // African-only user — use MyStocks wallet balance + local orders
    if (!user?.alpaca_account_id) {
      const msBalance = parseFloat(user?.mystocks_wallet_balance || 0);
      return res.json({
        success: true,
        provider: 'mystocks',
        performance: {
          period,
          summary: {
            currentEquity: msBalance,
            currentEquityKES: msBalance * exchangeRate,
            dayChange: 0, dayChangeKES: 0, dayChangePercent: 0,
            totalTrades: 0, totalBought: 0, totalBoughtKES: 0,
            totalSold: 0, totalSoldKES: 0, netFlow: 0, netFlowKES: 0
          },
          trading: { buyOrders: 0, sellOrders: 0, avgTradeSize: 0, mostTradedSymbol: null },
          bySymbol: [],
          exchangeRate
        }
      });
    }

    // Alpaca user — fetch account for equity
    const account = await alpacaService.getAccount(user.alpaca_account_id);

    // Get user's orders for the period
    const orders = await Order.findAll({
      where: {
        user_id: req.user.id,
        status: 'filled',
        filled_at: { [Order.sequelize.Sequelize.Op.between]: [startDate, endDate] }
      },
      order: [['filled_at', 'ASC']]
    });

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

    // Check if user has an Alpaca account
    const user = await User.findByPk(req.user.id);
    if (!user || !user.alpaca_account_id) {
      return res.status(404).json({
        success: false,
        message: 'No trading account found. Complete onboarding to start trading.'
      });
    }

    // Get current position for this specific user
    const positions = await alpacaService.getPositions(user.alpaca_account_id);
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

const getAssetTrend = async (req, res) => {
  try {
    const { timeframe = '1Day', limit = 30 } = req.query;

    // Check if user has an Alpaca account
    const user = await User.findByPk(req.user.id);
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    if (user?.account_mode === 'demo') {
      const demoBalance = parseFloat(user?.demo_balance || 0);
      const positions = await buildDemoPositions(req.user.id, exchangeRate);
      const invested = positions.reduce((s, p) => s + p.costBasis, 0);
      const currentValue = positions.reduce((s, p) => s + p.marketValue, 0) + demoBalance;
      const profit = currentValue - (invested + demoBalance);
      return res.json({
        success: true, provider: 'demo',
        portfolio: {
          invested, investedKES: invested * exchangeRate,
          currentValue, currentValueKES: currentValue * exchangeRate,
          profit, profitKES: profit * exchangeRate,
          profitPercent: invested > 0 ? (profit / invested) * 100 : 0,
          totalStocks: positions.length
        },
        chartData: [],
        summary: { period: { from: null, to: null, days: 0 }, highest: currentValue, lowest: invested, bestDay: 0, worstDay: 0, average: currentValue },
        exchangeRate, isDemo: true, lastUpdated: new Date().toISOString()
      });
    }

    if (!user || !user.alpaca_account_id) {
      // African-only user — build trend from MyStocks portfolio holdings
      let positions = [];
      try {
        if (user?.mystocks_sub_account_id) {
          const msPortfolio = await ms.getPortfolio(user.mystocks_sub_account_id);
          const holdings = Array.isArray(msPortfolio) ? msPortfolio
            : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
            : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];
          positions = holdings;
        }
      } catch (_) {}

      const msBalance = parseFloat(user?.mystocks_wallet_balance || 0);

      if (positions.length === 0) {
        return res.json({
          success: true,
          provider: 'mystocks',
          portfolio: {
            invested: 0, investedKES: 0,
            currentValue: msBalance, currentValueKES: msBalance * exchangeRate,
            profit: 0, profitKES: 0, profitPercent: 0,
            totalStocks: 0
          },
          chartData: [],
          summary: { period: { from: null, to: null, days: 0 }, highest: msBalance, lowest: 0, bestDay: 0, worstDay: 0, average: msBalance },
          exchangeRate,
          lastUpdated: new Date().toISOString()
        });
      }

      const invested = positions.reduce((s, h) => s + (parseFloat(h.averageCost || h.avgCost || 0) * parseFloat(h.quantity || h.qty || 0)), 0);
      const currentValue = positions.reduce((s, h) => s + (parseFloat(h.currentPrice || h.price || 0) * parseFloat(h.quantity || h.qty || 0)), 0);
      const profit = currentValue - invested;

      return res.json({
        success: true,
        provider: 'mystocks',
        portfolio: {
          invested, investedKES: invested * exchangeRate,
          currentValue, currentValueKES: currentValue * exchangeRate,
          profit, profitKES: profit * exchangeRate,
          profitPercent: invested > 0 ? (profit / invested) * 100 : 0,
          totalStocks: positions.length
        },
        chartData: [],
        summary: { period: { from: null, to: null, days: 0 }, highest: currentValue, lowest: invested, bestDay: 0, worstDay: 0, average: currentValue },
        exchangeRate,
        lastUpdated: new Date().toISOString()
      });
    }

    // Get all user's positions for this specific Alpaca account
    const positions = await alpacaService.getPositions(user.alpaca_account_id);

    if (!positions || positions.length === 0) {
      return res.json({
        success: true,
        portfolio: {
          invested: 0,
          investedKES: 0,
          currentValue: 0,
          currentValueKES: 0,
          profit: 0,
          profitKES: 0,
          profitPercent: 0,
          totalStocks: 0
        },
        chartData: [],
        summary: {
          period: { from: null, to: null, days: 0 },
          highest: 0,
          lowest: 0,
          bestDay: 0,
          worstDay: 0,
          average: 0
        },
        exchangeRate,
        lastUpdated: new Date().toISOString(),
        message: 'No positions found. Buy stocks to see your portfolio trend.'
      });
    }

    // Calculate total cost basis for all positions
    const totalCostBasis = positions.reduce((sum, pos) => sum + parseFloat(pos.cost_basis), 0);

    // Fetch historical data for all positions in parallel
    const historicalDataPromises = positions.map(async (position) => {
      try {
        const bars = await alpacaService.getBars(
          position.symbol.toUpperCase(),
          timeframe,
          null,
          null,
          Math.min(parseInt(limit), 100)
        );

        return {
          symbol: position.symbol,
          quantity: parseFloat(position.qty),
          costBasis: parseFloat(position.cost_basis),
          bars: bars || []
        };
      } catch (error) {
        logger.warn(`Failed to fetch bars for ${position.symbol}:`, error);
        return {
          symbol: position.symbol,
          quantity: parseFloat(position.qty),
          costBasis: parseFloat(position.cost_basis),
          bars: []
        };
      }
    });

    const allPositionData = await Promise.all(historicalDataPromises);

    // Group all bars by date and calculate total portfolio value per date
    const dateMap = new Map();

    allPositionData.forEach(posData => {
      posData.bars.forEach(bar => {
        const date = new Date(bar.t).toISOString().split('T')[0];
        const closePrice = parseFloat(bar.c);
        const marketValue = posData.quantity * closePrice;

        if (!dateMap.has(date)) {
          dateMap.set(date, {
            timestamp: bar.t,
            date,
            totalMarketValue: 0,
            positions: []
          });
        }

        const dateData = dateMap.get(date);
        dateData.totalMarketValue += marketValue;
        dateData.positions.push({
          symbol: posData.symbol,
          closePrice,
          quantity: posData.quantity,
          marketValue
        });
      });
    });

    // Convert map to sorted array and calculate P&L
    const chartData = Array.from(dateMap.values())
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(dateData => {
        const profitLoss = dateData.totalMarketValue - totalCostBasis;
        const profitLossPercent = totalCostBasis > 0 ? (profitLoss / totalCostBasis) * 100 : 0;

        return {
          timestamp: dateData.timestamp,
          date: dateData.date,
          totalMarketValue: parseFloat(dateData.totalMarketValue.toFixed(2)),
          totalMarketValueKES: parseFloat((dateData.totalMarketValue * exchangeRate).toFixed(2)),
          profitLoss: parseFloat(profitLoss.toFixed(2)),
          profitLossKES: parseFloat((profitLoss * exchangeRate).toFixed(2)),
          profitLossPercent: parseFloat(profitLossPercent.toFixed(2)),
          positionsCount: dateData.positions.length
        };
      });

    if (chartData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No historical data available for portfolio'
      });
    }

    // Calculate current stats
    const latestBar = chartData[chartData.length - 1];
    const firstBar = chartData[0];

    res.json({
      success: true,
      portfolio: {
        invested: totalCostBasis,
        investedKES: totalCostBasis * exchangeRate,
        currentValue: latestBar.totalMarketValue,
        currentValueKES: latestBar.totalMarketValueKES,
        profit: latestBar.profitLoss,
        profitKES: latestBar.profitLossKES,
        profitPercent: latestBar.profitLossPercent,
        totalStocks: positions.length
      },
      chartData: chartData.map(d => ({
        date: d.date,
        value: d.totalMarketValue,
        valueKES: d.totalMarketValueKES,
        profit: d.profitLoss,
        profitKES: d.profitLossKES,
        profitPercent: d.profitLossPercent,
        stocks: d.positionsCount
      })),
      summary: {
        period: {
          from: firstBar.date,
          to: latestBar.date,
          days: chartData.length
        },
        highest: Math.max(...chartData.map(d => d.totalMarketValue)),
        lowest: Math.min(...chartData.map(d => d.totalMarketValue)),
        bestDay: Math.max(...chartData.map(d => d.profitLoss)),
        worstDay: Math.min(...chartData.map(d => d.profitLoss)),
        average: parseFloat((chartData.reduce((sum, d) => sum + d.profitLoss, 0) / chartData.length).toFixed(2))
      },
      exchangeRate,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Get asset trend error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch asset trend data'
    });
  }
};

// Get portfolio allocation for pie chart
const getPortfolioAllocation = async (req, res) => {
  try {
    // Check if user has an Alpaca account
    const user = await User.findByPk(req.user.id);
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    // Get local wallet balance
    let wallet = await Wallet.findOne({ where: { user_id: req.user.id } });
    if (!wallet) {
      wallet = { kes_balance: 0, usd_balance: 0, frozen_kes: 0, frozen_usd: 0 };
    }
    const localKesBalance = parseFloat(wallet.kes_balance) || 0;
    const localUsdBalance = parseFloat(wallet.usd_balance) || 0;
    const localCashUsd = localUsdBalance + (localKesBalance / exchangeRate);

    if (!user || !user.alpaca_account_id) {
      // African-only user — build allocation from MyStocks portfolio + wallet
      let holdings = [];
      try {
        if (user?.mystocks_sub_account_id) {
          const msPortfolio = await ms.getPortfolio(user.mystocks_sub_account_id);
          const raw = Array.isArray(msPortfolio) ? msPortfolio
            : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
            : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];
          holdings = raw;
        }
      } catch (_) {}

      const msBalance = parseFloat(user?.mystocks_wallet_balance || 0);
      const marketValue = holdings.reduce((s, h) => s + (parseFloat(h.currentPrice || h.price || 0) * parseFloat(h.quantity || h.qty || 0)), 0);
      const portfolioValue = msBalance + marketValue + localCashUsd;

      const byStock = holdings.map(h => {
        const qty = parseFloat(h.quantity || h.qty || 0);
        const price = parseFloat(h.currentPrice || h.price || 0);
        const value = qty * price;
        return {
          symbol: h.symbol,
          name: h.name || h.symbol,
          value: parseFloat(value.toFixed(2)),
          valueKES: parseFloat((value * exchangeRate).toFixed(2)),
          percentage: portfolioValue > 0 ? parseFloat(((value / portfolioValue) * 100).toFixed(2)) : 0,
          qty,
          price,
          exchange: h.exchange || 'NSE'
        };
      });

      const bySector = Object.values(
        holdings.reduce((acc, h) => {
          const sector = h.sector || 'Other';
          const qty = parseFloat(h.quantity || h.qty || 0);
          const value = qty * parseFloat(h.currentPrice || h.price || 0);
          if (!acc[sector]) acc[sector] = { name: sector, value: 0, valueKES: 0, percentage: 0, count: 0 };
          acc[sector].value += value;
          acc[sector].valueKES += value * exchangeRate;
          acc[sector].count += 1;
          return acc;
        }, {})
      ).map(s => ({ ...s, value: parseFloat(s.value.toFixed(2)), valueKES: parseFloat(s.valueKES.toFixed(2)), percentage: portfolioValue > 0 ? parseFloat(((s.value / portfolioValue) * 100).toFixed(2)) : 0 }));

      const cashEntry = msBalance + localCashUsd > 0 ? [{
        name: 'Cash (MyStocks)',
        value: parseFloat((msBalance + localCashUsd).toFixed(2)),
        valueKES: parseFloat(((msBalance + localCashUsd) * exchangeRate).toFixed(2)),
        percentage: portfolioValue > 0 ? parseFloat((((msBalance + localCashUsd) / portfolioValue) * 100).toFixed(2)) : 100,
        count: 0, stocks: []
      }] : [];

      return res.json({
        success: true,
        provider: 'mystocks',
        allocation: {
          byAssetClass: [
            ...cashEntry,
            ...(marketValue > 0 ? [{ name: 'African Equities', value: parseFloat(marketValue.toFixed(2)), valueKES: parseFloat((marketValue * exchangeRate).toFixed(2)), percentage: portfolioValue > 0 ? parseFloat(((marketValue / portfolioValue) * 100).toFixed(2)) : 0, count: holdings.length, stocks: byStock }] : [])
          ],
          bySector,
          byStock,
          byExchange: holdings.length > 0 ? [{ name: 'NSE', value: parseFloat(marketValue.toFixed(2)), valueKES: parseFloat((marketValue * exchangeRate).toFixed(2)), percentage: marketValue > 0 ? 100 : 0, count: holdings.length }] : []
        },
        summary: {
          portfolioValue: parseFloat(portfolioValue.toFixed(2)),
          portfolioValueKES: parseFloat((portfolioValue * exchangeRate).toFixed(2)),
          cash: parseFloat((msBalance + localCashUsd).toFixed(2)),
          cashKES: parseFloat(((msBalance + localCashUsd) * exchangeRate).toFixed(2)),
          marketValue: parseFloat(marketValue.toFixed(2)),
          marketValueKES: parseFloat((marketValue * exchangeRate).toFixed(2)),
          totalPositions: holdings.length,
          exchangeRate
        },
        localWallet: { kesBalance: localKesBalance, usdBalance: localUsdBalance, totalUsd: localCashUsd },
        lastUpdated: new Date().toISOString()
      });
    }

    // Get account info to get cash balance
    const account = await alpacaService.getAccount(user.alpaca_account_id);
    const alpacaCash = parseFloat(account.cash || 0);

    // Get all user's positions for this specific Alpaca account
    const positions = await alpacaService.getPositions(user.alpaca_account_id);

    // Calculate market value of positions
    const marketValue = positions.reduce((sum, pos) => sum + parseFloat(pos.market_value), 0);

    // Combined cash = Alpaca cash + Local wallet
    const totalCash = alpacaCash + localCashUsd;

    // Portfolio value = total cash + market value of investments
    const portfolioValue = totalCash + marketValue;

    if (!positions || positions.length === 0) {
      return res.json({
        success: true,
        allocation: {
          byAssetClass: totalCash > 0 ? [{
            name: 'Cash',
            value: parseFloat(totalCash.toFixed(2)),
            valueKES: parseFloat((totalCash * exchangeRate).toFixed(2)),
            percentage: 100,
            count: 0,
            stocks: []
          }] : [],
          bySector: [],
          byStock: [],
          byExchange: []
        },
        summary: {
          portfolioValue: parseFloat(portfolioValue.toFixed(2)),
          portfolioValueKES: parseFloat((portfolioValue * exchangeRate).toFixed(2)),
          cash: parseFloat(totalCash.toFixed(2)),
          cashKES: parseFloat((totalCash * exchangeRate).toFixed(2)),
          marketValue: 0,
          marketValueKES: 0,
          totalPositions: 0,
          exchangeRate
        },
        localWallet: {
          kesBalance: localKesBalance,
          usdBalance: localUsdBalance,
          totalUsd: localCashUsd
        },
        lastUpdated: new Date().toISOString(),
        message: 'No positions found. Buy stocks to see your portfolio allocation.'
      });
    }

    // Total value for percentage calculations (includes cash)
    const totalValue = portfolioValue;

    // Fetch additional data for each position (sector, industry)
    const positionDetails = await Promise.all(
      positions.map(async (position) => {
        const marketValue = parseFloat(position.market_value);
        const percentage = totalValue > 0 ? (marketValue / totalValue) * 100 : 0;

        // Try to get asset details for sector/industry info
        let sector = 'Unknown';
        let industry = 'Unknown';
        let exchange = position.exchange || 'NASDAQ';
        let assetClass = position.asset_class || 'us_equity';

        try {
          // Get asset info from Alpaca
          const asset = await alpacaService.getAsset(position.symbol);
          exchange = asset.exchange || exchange;
          assetClass = asset.class || assetClass;
        } catch (assetError) {
          logger.warn(`Could not get asset details for ${position.symbol}`);
        }

        // Determine asset class label
        let assetClassLabel = 'US Stocks';
        if (assetClass === 'us_equity' || assetClass === 'us_stock') {
          assetClassLabel = 'US Stocks';
        } else if (assetClass === 'ke_equity' || assetClass === 'ke_stock') {
          assetClassLabel = 'KE Stocks';
        } else if (assetClass === 'crypto') {
          assetClassLabel = 'Crypto';
        } else if (assetClass === 'etf') {
          assetClassLabel = 'ETFs';
        }

        return {
          symbol: position.symbol,
          name: position.symbol, // Could fetch company name
          marketValue,
          marketValueKES: marketValue * exchangeRate,
          percentage: parseFloat(percentage.toFixed(2)),
          quantity: parseFloat(position.qty),
          currentPrice: parseFloat(position.current_price),
          assetClass,
          assetClassLabel,
          sector,
          industry,
          exchange,
          unrealizedPL: parseFloat(position.unrealized_pl),
          unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100
        };
      })
    );

    // Group by Asset Class
    const assetClassGroups = {};
    positionDetails.forEach(pos => {
      const key = pos.assetClassLabel;
      if (!assetClassGroups[key]) {
        assetClassGroups[key] = {
          name: key,
          value: 0,
          valueKES: 0,
          percentage: 0,
          count: 0,
          stocks: []
        };
      }
      assetClassGroups[key].value += pos.marketValue;
      assetClassGroups[key].valueKES += pos.marketValueKES;
      assetClassGroups[key].count += 1;
      assetClassGroups[key].stocks.push(pos.symbol);
    });

    // Add Cash as an asset class if there's cash in the account
    if (totalCash > 0) {
      assetClassGroups['Cash'] = {
        name: 'Cash',
        value: totalCash,
        valueKES: totalCash * exchangeRate,
        percentage: 0,
        count: 0,
        stocks: []
      };
    }

    // Calculate percentages for asset classes
    const byAssetClass = Object.values(assetClassGroups).map(group => ({
      ...group,
      percentage: parseFloat(((group.value / totalValue) * 100).toFixed(2)),
      value: parseFloat(group.value.toFixed(2)),
      valueKES: parseFloat(group.valueKES.toFixed(2))
    })).sort((a, b) => b.percentage - a.percentage);

    // Group by Exchange
    const exchangeGroups = {};
    positionDetails.forEach(pos => {
      const key = pos.exchange;
      if (!exchangeGroups[key]) {
        exchangeGroups[key] = {
          name: key,
          value: 0,
          valueKES: 0,
          percentage: 0,
          count: 0,
          stocks: []
        };
      }
      exchangeGroups[key].value += pos.marketValue;
      exchangeGroups[key].valueKES += pos.marketValueKES;
      exchangeGroups[key].count += 1;
      exchangeGroups[key].stocks.push(pos.symbol);
    });

    // Calculate percentages for exchanges
    const byExchange = Object.values(exchangeGroups).map(group => ({
      ...group,
      percentage: parseFloat(((group.value / totalValue) * 100).toFixed(2)),
      value: parseFloat(group.value.toFixed(2)),
      valueKES: parseFloat(group.valueKES.toFixed(2))
    })).sort((a, b) => b.percentage - a.percentage);

    // Group by Sector (placeholder - would need external data source)
    const sectorGroups = {};
    positionDetails.forEach(pos => {
      const key = pos.sector;
      if (!sectorGroups[key]) {
        sectorGroups[key] = {
          name: key,
          value: 0,
          valueKES: 0,
          percentage: 0,
          count: 0,
          stocks: []
        };
      }
      sectorGroups[key].value += pos.marketValue;
      sectorGroups[key].valueKES += pos.marketValueKES;
      sectorGroups[key].count += 1;
      sectorGroups[key].stocks.push(pos.symbol);
    });

    // Calculate percentages for sectors
    const bySector = Object.values(sectorGroups).map(group => ({
      ...group,
      percentage: parseFloat(((group.value / totalValue) * 100).toFixed(2)),
      value: parseFloat(group.value.toFixed(2)),
      valueKES: parseFloat(group.valueKES.toFixed(2))
    })).sort((a, b) => b.percentage - a.percentage);

    // Individual stocks allocation
    const byStock = positionDetails.map(pos => ({
      symbol: pos.symbol,
      name: pos.name,
      value: parseFloat(pos.marketValue.toFixed(2)),
      valueKES: parseFloat(pos.marketValueKES.toFixed(2)),
      percentage: pos.percentage,
      quantity: pos.quantity,
      currentPrice: pos.currentPrice,
      unrealizedPL: parseFloat(pos.unrealizedPL.toFixed(2)),
      unrealizedPLPercent: parseFloat(pos.unrealizedPLPercent.toFixed(2))
    })).sort((a, b) => b.percentage - a.percentage);

    res.json({
      success: true,
      allocation: {
        byAssetClass,
        byExchange,
        bySector,
        byStock
      },
      summary: {
        portfolioValue: parseFloat(portfolioValue.toFixed(2)),
        portfolioValueKES: parseFloat((portfolioValue * exchangeRate).toFixed(2)),
        cash: parseFloat(totalCash.toFixed(2)),
        cashKES: parseFloat((totalCash * exchangeRate).toFixed(2)),
        marketValue: parseFloat(marketValue.toFixed(2)),
        marketValueKES: parseFloat((marketValue * exchangeRate).toFixed(2)),
        totalPositions: positions.length,
        exchangeRate
      },
      localWallet: {
        kesBalance: localKesBalance,
        usdBalance: localUsdBalance,
        totalUsd: localCashUsd
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Get portfolio allocation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch portfolio allocation data'
    });
  }
};

module.exports = {
  getPortfolio,
  getPositions,
  getPosition,
  getPerformance,
  closePosition,
  getAssetTrend,
  getPortfolioAllocation
};