const { User, Order, Wallet, MsOrder, DemoOrder } = require('../models');
const alpacaService = require('../services/alpacaService');
const ms = require('../services/mystocksService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');
const { getProviderFlags } = require('../services/platformConfigService');

const AFRICAN_EXCHANGES = new Set(['NSE', 'NGX', 'JSE', 'GSE', 'BRVM', 'LUSE', 'EGX', 'BSE', 'SEM']);

// Build a symbol → weighted avg USD entry price lookup from local MsOrder history
const computeAvgEntryPrices = (msOrders) => {
  const bySymbol = {};
  for (const o of msOrders) {
    const sym = o.symbol;
    if (!bySymbol[sym]) bySymbol[sym] = { totalQty: 0, totalCost: 0 };
    const qty = parseFloat(o.quantity);
    const price = parseFloat(o.usd_price || 0);
    if (o.side === 'BUY') { bySymbol[sym].totalQty += qty; bySymbol[sym].totalCost += qty * price; }
    else { bySymbol[sym].totalQty -= qty; bySymbol[sym].totalCost -= qty * price; }
  }
  return (sym) => {
    const d = bySymbol[sym];
    return d && d.totalQty > 0 ? d.totalCost / d.totalQty : 0;
  };
};

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
    // Fetch user, wallet, exchange rate, and provider flags in parallel
    const [user, walletRow, exchangeRate, { alpacaEnabled, mystocksEnabled }] = await Promise.all([
      User.findByPk(req.user.id),
      Wallet.findOne({ where: { user_id: req.user.id } }),
      exchangeService.getExchangeRate('USD', 'KES'),
      getProviderFlags()
    ]);

    const wallet = walletRow || { kes_balance: 0, usd_balance: 0, frozen_kes: 0, frozen_usd: 0 };
    const localKesBalance = parseFloat(wallet.kes_balance) || 0;
    const localUsdBalance = parseFloat(wallet.usd_balance) || 0;

    // Demo mode: return demo portfolio (same logic as paper trading)
    const isDemo = user?.account_mode === 'demo' || process.env.NODE_ENV === 'development';
    if (isDemo) {
      const demoBalance = parseFloat(user?.demo_balance || 10000);
      const demoPositions = await buildDemoPositions(req.user.id, exchangeRate).catch(() => []);
      const demoMarketValue = demoPositions.reduce((s, p) => s + (p.marketValue || 0), 0);
      const totalEquity = demoBalance + demoMarketValue;
      return res.json({
        success: true,
        provider: 'demo',
        accountMode: 'demo',
        portfolio: {
          summary: {
            totalEquity,
            totalEquityKES: totalEquity * exchangeRate,
            dayChange: 0,
            dayChangeKES: 0,
            dayChangePercent: 0,
            buyingPower: demoBalance,
            buyingPowerKES: demoBalance * exchangeRate,
            cash: demoBalance,
            cashKES: demoBalance * exchangeRate,
            portfolioValue: totalEquity,
            portfolioValueKES: totalEquity * exchangeRate,
            demoBalance,
            demoBalanceKES: demoBalance * exchangeRate,
            lastUpdated: new Date().toISOString()
          },
          positions: demoPositions,
          positionsCount: demoPositions.length,
          exchangeRate,
          account: null,
          localWallet: { kesBalance: localKesBalance, usdBalance: localUsdBalance }
        }
      });
    }

    if (!user || !user.alpaca_account_id || (!alpacaEnabled && mystocksEnabled)) {
      // MyStocks-only path: no Alpaca account, Alpaca disabled, or MyStocks-only mode
      if (!mystocksEnabled) {
        return res.status(503).json({ success: false, message: 'Trading services are currently unavailable.' });
      }
      // African-only user — fetch MyStocks portfolio + wallet
      let msPortfolio = null;
      let msUsdBalance = parseFloat(user?.mystocks_wallet_balance || 0);
      let pendingOrders = [];
      let getAvgEntry = () => 0;

      try {
        if (user?.mystocks_sub_account_id) {
          const [portfolioData, walletData, ordersData, msOrdersData] = await Promise.allSettled([
            ms.getPortfolio(user.mystocks_sub_account_id),
            ms.getWallet(user.mystocks_sub_account_id),
            ms.getUserOrders(user.mystocks_sub_account_id, { status: 'PENDING' }),
            MsOrder.findAll({ where: { user_id: req.user.id }, order: [['filled_at', 'ASC']] })
          ]);
          if (portfolioData.status === 'fulfilled') msPortfolio = portfolioData.value;
          if (walletData.status === 'fulfilled') {
            const apiBalance = parseFloat(walletData.value?.wallet?.balance || walletData.value?.balance || 0);
            if (apiBalance > 0) msUsdBalance = apiBalance;
          }
          if (ordersData.status === 'fulfilled') {
            pendingOrders = Array.isArray(ordersData.value?.orders) ? ordersData.value.orders : [];
          }
          getAvgEntry = computeAvgEntryPrices(msOrdersData.status === 'fulfilled' ? msOrdersData.value : []);
        }
      } catch (_) {}

      const positions = [];
      if (msPortfolio) {
        const holdings = Array.isArray(msPortfolio) ? msPortfolio
          : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
          : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];

        logger.info('MyStocks portfolio raw holdings sample:', JSON.stringify(holdings[0] || {}));
        holdings.forEach(h => {
          const qty = parseFloat(h.quantity || h.qty || h.units || h.shares || 0);
          if (qty <= 0) return; // skip expired/cancelled zero-qty entries

          // Try every known field name for per-unit price
          const unitPrice = parseFloat(
            h.currentPrice || h.price || h.localPrice || h.lastPrice ||
            h.marketPrice || h.usdPrice || h.unitPrice || h.closePrice ||
            h.tradePrice || h.currentUnitPrice || 0
          );
          // Fallback: some APIs return total value instead of unit price
          const totalVal = parseFloat(h.value || h.currentValue || h.totalValue || h.marketValue || 0);
          const price = unitPrice || (qty > 0 && totalVal > 0 ? totalVal / qty : 0);

          const nativeCost = parseFloat(
            h.averageCost || h.avgCost || h.averagePrice || h.avgPrice ||
            h.purchasePrice || h.costBasis || 0
          );
          const cost = nativeCost || getAvgEntry(h.symbol) || price;
          const marketValue = qty * price;
          const unrealizedPL = marketValue - (qty * cost);
          positions.push({
            symbol: h.symbol,
            name: h.name || h.symbol,
            quantity: Math.ceil(qty),
            averageEntryPrice: cost,
            currentPrice: price,
            marketValue,
            marketValueKES: marketValue * exchangeRate,
            unrealizedPL,
            unrealizedPLKES: unrealizedPL * exchangeRate,
            unrealizedPLPercent: cost > 0 ? (unrealizedPL / (qty * cost)) * 100 : 0,
            exchange: h.exchange || 'NSE',
            currency: h.currency || 'KES',
            status: h.status ? h.status.toLowerCase() : 'filled',
            provider: 'mystocks'
          });
        });
      }

      // Append pending orders not already in filled holdings
      const filledSymbols = new Set(positions.map(p => p.symbol));
      pendingOrders.forEach(o => {
        const priceUsd = parseFloat(o.usdPriceAtOrder || 0);
        const qty = parseFloat(o.quantity || 0);
        const totalUsd = parseFloat(o.totalAmount || qty * priceUsd);
        positions.push({
          symbol: o.symbol,
          name: o.stockName || o.symbol,
          quantity: Math.ceil(qty),
          averageEntryPrice: priceUsd,
          currentPrice: priceUsd,
          marketValue: totalUsd,
          marketValueKES: totalUsd * exchangeRate,
          unrealizedPL: 0,
          unrealizedPLKES: 0,
          unrealizedPLPercent: 0,
          exchange: o.exchange || 'NSE',
          currency: 'USD',
          status: 'pending',
          orderId: o.orderId,
          placedAt: o.createdAt,
          provider: 'mystocks'
        });
      });

      // If live portfolio and pending orders are both empty, fall back to local MsOrder history
      if (positions.length === 0) {
        const msOrderHistory = await MsOrder.findAll({
          where: { user_id: req.user.id },
          order: [['filled_at', 'ASC']]
        });
        const bySymbol = {};
        for (const o of msOrderHistory) {
          const sym = o.symbol;
          if (!bySymbol[sym]) bySymbol[sym] = { symbol: sym, exchange: o.exchange || 'NSE', currency: o.currency || 'KES', totalQty: 0, totalCost: 0 };
          const qty = parseFloat(o.quantity);
          const price = parseFloat(o.usd_price || o.local_price || 0);
          if (o.side === 'BUY') { bySymbol[sym].totalQty += qty; bySymbol[sym].totalCost += qty * price; }
          else { bySymbol[sym].totalQty -= qty; bySymbol[sym].totalCost -= qty * price; }
        }
        const msPositions = await Promise.all(
          Object.values(bySymbol).filter(p => p.totalQty > 0.0001).map(async p => {
            let currentPrice = p.totalQty > 0 && p.totalCost > 0 ? p.totalCost / p.totalQty : 0;
            try {
              // Strip .KE/.ZA suffix — MyStocks search doesn't accept the suffix
              const ticker = p.symbol.includes('.') ? p.symbol.split('.')[0] : p.symbol;
              const stocks = await ms.getStocks({ search: ticker });
              const stock = Array.isArray(stocks) ? stocks[0] : stocks?.stocks?.[0];
              if (stock?.usdPrice) currentPrice = parseFloat(stock.usdPrice);
              else if (stock?.price) currentPrice = parseFloat(stock.price) / (exchangeRate || 1);
            } catch (_) {}
            const marketValue = p.totalQty * currentPrice;
            return {
              symbol: p.symbol,
              name: p.symbol,
              quantity: Math.ceil(p.totalQty),
              averageEntryPrice: p.totalQty > 0 && p.totalCost > 0 ? p.totalCost / p.totalQty : 0,
              currentPrice,
              marketValue,
              marketValueKES: marketValue * (exchangeRate || 1),
              unrealizedPL: 0,
              unrealizedPLKES: 0,
              unrealizedPLPercent: 0,
              exchange: p.exchange,
              currency: p.currency,
              status: 'open',
              provider: 'mystocks'
            };
          })
        );
        positions.push(...msPositions);
      }

      const localCashUsd = localUsdBalance + (localKesBalance / (exchangeRate || 1));
      const holdingsValue = positions.reduce((s, p) => s + p.marketValue, 0);
      const totalEquity = msUsdBalance + holdingsValue + localCashUsd;
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

    if (!alpacaEnabled) {
      return res.status(503).json({ success: false, message: 'US market trading is currently disabled.' });
    }

    // Fetch Alpaca account, positions, and local orders in parallel
    const [account, positions, userOrders] = await Promise.all([
      alpacaService.getAccount(user.alpaca_account_id),
      alpacaService.getPositions(user.alpaca_account_id),
      Order.findAll({
        where: { user_id: req.user.id },
        order: [['created_at', 'DESC']],
        limit: 100
      })
    ]);

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

    if (!user || !user.alpaca_account_id) {
      // Try live MyStocks portfolio first, fall back to locally saved ms_orders
      let positions = [];
      const msOrdersForAvg = await MsOrder.findAll({ where: { user_id: req.user.id }, order: [['filled_at', 'ASC']] }).catch(() => []);
      const getAvgEntry = computeAvgEntryPrices(msOrdersForAvg);
      try {
        if (user?.mystocks_sub_account_id) {
          const msPortfolio = await ms.getPortfolio(user.mystocks_sub_account_id);
          const holdings = Array.isArray(msPortfolio) ? msPortfolio
            : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
            : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];
          if (holdings.length > 0) {
            positions = holdings
              .filter(h => parseFloat(h.quantity || h.qty || h.units || h.shares || 0) > 0)
              .map(h => {
                const qty = parseFloat(h.quantity || h.qty || h.units || h.shares || 0);
                const unitPrice = parseFloat(
                  h.currentPrice || h.price || h.localPrice || h.lastPrice ||
                  h.marketPrice || h.usdPrice || h.unitPrice || h.closePrice ||
                  h.tradePrice || h.currentUnitPrice || 0
                );
                const totalVal = parseFloat(h.value || h.currentValue || h.totalValue || h.marketValue || 0);
                const price = unitPrice || (qty > 0 && totalVal > 0 ? totalVal / qty : 0);
                const nativeCost = parseFloat(
                  h.averageCost || h.avgCost || h.averagePrice || h.avgPrice ||
                  h.purchasePrice || h.costBasis || 0
                );
                const cost = nativeCost || getAvgEntry(h.symbol) || price;
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
          const [msPortfolio, msOrdersForAvg] = await Promise.all([
            ms.getPortfolio(user.mystocks_sub_account_id),
            MsOrder.findAll({ where: { user_id: req.user.id, symbol: symbol.toUpperCase() }, order: [['filled_at', 'ASC']] })
          ]);
          const getAvgEntry = computeAvgEntryPrices(msOrdersForAvg);
          const holdings = Array.isArray(msPortfolio) ? msPortfolio
            : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
            : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];
          const holding = holdings.find(h => h.symbol?.toUpperCase() === symbol.toUpperCase());
          if (holding) {
            const qty = parseFloat(holding.quantity || holding.qty || holding.units || holding.shares || 0);
            const unitPrice = parseFloat(
              holding.currentPrice || holding.price || holding.localPrice || holding.lastPrice ||
              holding.marketPrice || holding.usdPrice || holding.unitPrice || holding.closePrice ||
              holding.tradePrice || holding.currentUnitPrice || 0
            );
            const totalVal = parseFloat(holding.value || holding.currentValue || holding.totalValue || holding.marketValue || 0);
            const price = unitPrice || (qty > 0 && totalVal > 0 ? totalVal / qty : 0);
            const nativeCost = parseFloat(
              holding.averageCost || holding.avgCost || holding.averagePrice || holding.avgPrice ||
              holding.purchasePrice || holding.costBasis || 0
            );
            const cost = nativeCost || getAvgEntry(symbol.toUpperCase()) || price;
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

    // African-only user — compute performance from MsOrder history
    if (!user?.alpaca_account_id) {
      const orders = await MsOrder.findAll({
        where: {
          user_id: req.user.id,
          filled_at: { [MsOrder.sequelize.Sequelize.Op.between]: [startDate, endDate] }
        },
        order: [['filled_at', 'ASC']]
      });

      // currentEquity = cash balance + market value of current holdings
      let currentEquity = parseFloat(user?.mystocks_wallet_balance || 0);
      try {
        if (user?.mystocks_sub_account_id) {
          const [walletResult, portfolioResult] = await Promise.allSettled([
            ms.getWallet(user.mystocks_sub_account_id),
            ms.getPortfolio(user.mystocks_sub_account_id)
          ]);
          const cashBalance = walletResult.status === 'fulfilled'
            ? parseFloat(walletResult.value?.wallet?.balance || walletResult.value?.balance || 0)
            : 0;
          let holdingsValue = 0;
          if (portfolioResult.status === 'fulfilled') {
            const ph = portfolioResult.value;
            const hList = Array.isArray(ph) ? ph
              : Array.isArray(ph?.holdings) ? ph.holdings
              : Array.isArray(ph?.positions) ? ph.positions : [];
            holdingsValue = hList.reduce((s, h) => {
              const qty = parseFloat(h.quantity || h.qty || h.units || h.shares || 0);
              if (qty <= 0) return s;
              const unitPrice = parseFloat(
                h.currentPrice || h.price || h.localPrice || h.lastPrice ||
                h.marketPrice || h.usdPrice || h.unitPrice || h.closePrice ||
                h.tradePrice || h.currentUnitPrice || 0
              );
              const totalVal = parseFloat(h.value || h.currentValue || h.totalValue || h.marketValue || 0);
              const price = unitPrice || (qty > 0 && totalVal > 0 ? totalVal / qty : 0);
              return s + qty * price;
            }, 0);
          }
          currentEquity = cashBalance + holdingsValue;
        }
      } catch (_) {}

      // Live portfolio returns no price data for these symbols — compute holdings value
      // the same way getPositions does: MsOrder net qty + ms.getStocks current price
      if (currentEquity <= 0) {
        const allMsOrders = await MsOrder.findAll({ where: { user_id: req.user.id }, order: [['filled_at', 'ASC']] });
        const bySymbol = {};
        for (const o of allMsOrders) {
          const sym = o.symbol;
          if (!bySymbol[sym]) bySymbol[sym] = { symbol: sym, totalQty: 0 };
          const qty = parseFloat(o.quantity);
          if (o.side === 'BUY') bySymbol[sym].totalQty += qty;
          else bySymbol[sym].totalQty -= qty;
        }
        const activeHoldings = Object.values(bySymbol).filter(p => p.totalQty > 0.0001);
        const holdingValues = await Promise.all(
          activeHoldings.map(async p => {
            try {
              const ticker = p.symbol.includes('.') ? p.symbol.split('.')[0] : p.symbol;
              const stocks = await ms.getStocks({ search: ticker });
              const stock = Array.isArray(stocks) ? stocks[0] : stocks?.stocks?.[0];
              const price = stock?.usdPrice ? parseFloat(stock.usdPrice)
                : stock?.price ? parseFloat(stock.price) / (exchangeRate || 1)
                : 0;
              return p.totalQty * price;
            } catch (_) { return 0; }
          })
        );
        currentEquity = holdingValues.reduce((s, v) => s + v, 0);
      }

      const buyOrders = orders.filter(o => o.side === 'BUY');
      const sellOrders = orders.filter(o => o.side === 'SELL');

      const totalBought = buyOrders.reduce((s, o) => s + parseFloat(o.total_cost_usd || (parseFloat(o.quantity) * parseFloat(o.usd_price || 0))), 0);
      const totalSold = sellOrders.reduce((s, o) => s + parseFloat(o.total_cost_usd || (parseFloat(o.quantity) * parseFloat(o.usd_price || 0))), 0);

      // Group by symbol
      const symbolMap = {};
      orders.forEach(o => {
        const sym = o.symbol;
        if (!symbolMap[sym]) symbolMap[sym] = {
          symbol: sym, exchange: o.exchange || 'NSE',
          totalTrades: 0, buyQty: 0, sellQty: 0,
          totalBought: 0, totalSold: 0, avgBuyPrice: 0, avgSellPrice: 0
        };
        const qty = parseFloat(o.quantity);
        const price = parseFloat(o.usd_price || 0);
        const value = parseFloat(o.total_cost_usd || qty * price);
        symbolMap[sym].totalTrades += 1;
        if (o.side === 'BUY') {
          symbolMap[sym].buyQty += qty;
          symbolMap[sym].totalBought += value;
          symbolMap[sym].avgBuyPrice = symbolMap[sym].buyQty > 0 ? symbolMap[sym].totalBought / symbolMap[sym].buyQty : 0;
        } else {
          symbolMap[sym].sellQty += qty;
          symbolMap[sym].totalSold += value;
          symbolMap[sym].avgSellPrice = symbolMap[sym].sellQty > 0 ? symbolMap[sym].totalSold / symbolMap[sym].sellQty : 0;
        }
      });

      const bySymbol = Object.values(symbolMap)
        .sort((a, b) => b.totalTrades - a.totalTrades)
        .map(s => ({
          ...s,
          totalBought: parseFloat(s.totalBought.toFixed(4)),
          totalBoughtKES: parseFloat((s.totalBought * exchangeRate).toFixed(2)),
          totalSold: parseFloat(s.totalSold.toFixed(4)),
          totalSoldKES: parseFloat((s.totalSold * exchangeRate).toFixed(2)),
          avgBuyPrice: parseFloat(s.avgBuyPrice.toFixed(6)),
          avgSellPrice: parseFloat(s.avgSellPrice.toFixed(6))
        }));

      const totalTrades = orders.length;
      const avgTradeSize = totalTrades > 0 ? (totalBought + totalSold) / totalTrades : 0;

      return res.json({
        success: true,
        provider: 'mystocks',
        performance: {
          period,
          summary: {
            currentEquity: parseFloat(currentEquity.toFixed(4)),
            currentEquityKES: parseFloat((currentEquity * exchangeRate).toFixed(2)),
            dayChange: 0, dayChangeKES: 0, dayChangePercent: 0,
            totalTrades,
            totalBought: parseFloat(totalBought.toFixed(4)),
            totalBoughtKES: parseFloat((totalBought * exchangeRate).toFixed(2)),
            totalSold: parseFloat(totalSold.toFixed(4)),
            totalSoldKES: parseFloat((totalSold * exchangeRate).toFixed(2)),
            netFlow: parseFloat((totalBought - totalSold).toFixed(4)),
            netFlowKES: parseFloat(((totalBought - totalSold) * exchangeRate).toFixed(2))
          },
          trading: {
            buyOrders: buyOrders.length,
            sellOrders: sellOrders.length,
            avgTradeSize: parseFloat(avgTradeSize.toFixed(4)),
            mostTradedSymbol: bySymbol[0]?.symbol || null
          },
          bySymbol,
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

    if (!user || !user.alpaca_account_id) {
      // African-only user — build trend from ms_orders history + live MyStocks data
      const limitNum = Math.min(parseInt(limit) || 30, 100);

      const [msPortfolioResult, msWalletResult, pendingOrdersResult, dbOrders, walletRow] = await Promise.allSettled([
        user?.mystocks_sub_account_id ? ms.getPortfolio(user.mystocks_sub_account_id) : Promise.resolve(null),
        user?.mystocks_sub_account_id ? ms.getWallet(user.mystocks_sub_account_id) : Promise.resolve(null),
        user?.mystocks_sub_account_id ? ms.getUserOrders(user.mystocks_sub_account_id) : Promise.resolve({ orders: [] }),
        MsOrder.findAll({
          where: { user_id: req.user.id },
          order: [['filled_at', 'ASC']],
          limit: 500
        }),
        Wallet.findOne({ where: { user_id: req.user.id } })
      ]);

      const msPortfolio = msPortfolioResult.status === 'fulfilled' ? msPortfolioResult.value : null;
      const msWalletRaw = msWalletResult.status === 'fulfilled' ? msWalletResult.value : null;
      const msWalletBalance = parseFloat(msWalletRaw?.wallet?.balance || msWalletRaw?.balance || user?.mystocks_wallet_balance || 0);
      const allMsOrders = pendingOrdersResult.status === 'fulfilled' ? (pendingOrdersResult.value?.orders || []) : [];
      const orders = dbOrders.status === 'fulfilled' ? dbOrders.value : [];
      const localWallet = walletRow.status === 'fulfilled' ? walletRow.value : null;
      const localKesBalance = parseFloat(localWallet?.kes_balance || 0);
      const localUsdBalance = parseFloat(localWallet?.usd_balance || 0);
      const localCashUsd = localUsdBalance + (localKesBalance / (exchangeRate || 1));

      // Current filled holdings from MyStocks
      const holdings = msPortfolio
        ? (Array.isArray(msPortfolio) ? msPortfolio
          : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
          : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [])
        : [];

      // Pending orders from MyStocks API
      const pendingOrders = allMsOrders.filter(o => o.status === 'PENDING');

      // Invested = sum of all BUY db orders minus SELL proceeds
      const totalInvested = orders
        .filter(o => o.side === 'BUY')
        .reduce((s, o) => s + parseFloat(o.total_cost_usd || 0), 0);
      const totalSellProceeds = orders
        .filter(o => o.side === 'SELL')
        .reduce((s, o) => s + parseFloat(o.total_cost_usd || 0), 0);
      const netInvested = Math.max(0, totalInvested - totalSellProceeds);

      // Current value = filled holdings market value + pending order amounts + cash
      const holdingsValue = holdings.reduce((s, h) => {
        const qty = parseFloat(h.quantity || h.qty || h.units || h.shares || 0);
        if (qty <= 0) return s;
        const unitPrice = parseFloat(h.currentPrice || h.price || h.localPrice || h.lastPrice || h.marketPrice || h.usdPrice || h.unitPrice || 0);
        const totalVal = parseFloat(h.value || h.currentValue || h.totalValue || h.marketValue || 0);
        const price = unitPrice || (totalVal > 0 ? totalVal / qty : 0);
        return s + price * qty;
      }, 0);
      const pendingValue = pendingOrders.reduce((s, o) => s + parseFloat(o.totalAmount || 0), 0);
      const currentValue = holdingsValue + pendingValue + msWalletBalance + localCashUsd;
      const profit = currentValue - netInvested;

      // Build chart from db order history — cumulative portfolio value per day
      const dayMap = new Map();
      let running = 0;
      orders.forEach(o => {
        const day = new Date(o.filled_at || o.created_at).toISOString().split('T')[0];
        const cost = parseFloat(o.total_cost_usd || 0);
        running += o.side === 'BUY' ? cost : -cost;
        dayMap.set(day, { date: day, value: Math.max(0, running) });
      });

      // Always include today's actual current value as the last point
      const today = new Date().toISOString().split('T')[0];
      dayMap.set(today, { date: today, value: currentValue });

      const chartPoints = Array.from(dayMap.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-limitNum);

      const values = chartPoints.map(p => p.value);
      const highest = values.length ? Math.max(...values) : 0;
      const lowest = values.length ? Math.min(...values) : 0;
      const average = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
      const dayChanges = chartPoints.map((p, i) => i > 0 ? p.value - chartPoints[i - 1].value : 0);

      const chartData = chartPoints.map(p => ({
        date: p.date,
        value: Math.round(p.value * 10000) / 10000,
        valueKES: Math.round(p.value * exchangeRate * 100) / 100
      }));

      return res.json({
        success: true,
        provider: 'mystocks',
        portfolio: {
          invested: Math.round(netInvested * 10000) / 10000,
          investedKES: Math.round(netInvested * exchangeRate * 100) / 100,
          currentValue: Math.round(currentValue * 10000) / 10000,
          currentValueKES: Math.round(currentValue * exchangeRate * 100) / 100,
          profit: Math.round(profit * 10000) / 10000,
          profitKES: Math.round(profit * exchangeRate * 100) / 100,
          profitPercent: netInvested > 0 ? Math.round((profit / netInvested) * 10000) / 100 : 0,
          totalStocks: holdings.length + pendingOrders.length,
          cash: msWalletBalance + localCashUsd,
          cashKES: Math.round((msWalletBalance + localCashUsd) * exchangeRate * 100) / 100,
          myStocksCash: msWalletBalance,
          myStocksCashKES: Math.round(msWalletBalance * exchangeRate * 100) / 100,
          localCash: localCashUsd,
          localCashKES: Math.round(localCashUsd * exchangeRate * 100) / 100
        },
        chartData,
        summary: {
          period: {
            from: chartData[0]?.date || null,
            to: chartData[chartData.length - 1]?.date || null,
            days: chartData.length
          },
          highest: Math.round(highest * 10000) / 10000,
          lowest: Math.round(lowest * 10000) / 10000,
          bestDay: Math.round(Math.max(0, ...dayChanges) * 10000) / 10000,
          worstDay: Math.round(Math.min(0, ...dayChanges) * 10000) / 10000,
          average: Math.round(average * 10000) / 10000
        },
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
      let getAvgEntry = () => 0;
      let msBalance = parseFloat(user?.mystocks_wallet_balance || 0);
      try {
        if (user?.mystocks_sub_account_id) {
          const [msPortfolio, msWalletData, msOrdersForAvg] = await Promise.all([
            ms.getPortfolio(user.mystocks_sub_account_id),
            ms.getWallet(user.mystocks_sub_account_id),
            MsOrder.findAll({ where: { user_id: req.user.id }, order: [['filled_at', 'ASC']] })
          ]);
          const liveBalance = parseFloat(msWalletData?.wallet?.balance || msWalletData?.balance || 0);
          if (liveBalance > 0) msBalance = liveBalance;
          getAvgEntry = computeAvgEntryPrices(msOrdersForAvg);
          const raw = Array.isArray(msPortfolio) ? msPortfolio
            : Array.isArray(msPortfolio?.holdings) ? msPortfolio.holdings
            : Array.isArray(msPortfolio?.positions) ? msPortfolio.positions : [];
          holdings = raw;
        }
      } catch (_) {}

      // Normalize holdings with full price fallback chain (same as getPortfolio)
      const normalizedHoldings = holdings
        .map(h => {
          const qty = parseFloat(h.quantity || h.qty || h.units || h.shares || 0);
          if (qty <= 0) return null;
          const unitPrice = parseFloat(
            h.currentPrice || h.price || h.localPrice || h.lastPrice ||
            h.marketPrice || h.usdPrice || h.unitPrice || h.closePrice ||
            h.tradePrice || h.currentUnitPrice || 0
          );
          const totalVal = parseFloat(h.value || h.currentValue || h.totalValue || h.marketValue || 0);
          const price = unitPrice || (qty > 0 && totalVal > 0 ? totalVal / qty : 0);
          const nativeCost = parseFloat(
            h.averageCost || h.avgCost || h.averagePrice || h.avgPrice ||
            h.purchasePrice || h.costBasis || 0
          );
          const cost = nativeCost || getAvgEntry(h.symbol) || price;
          return { h, qty, price, cost, value: qty * price, exchange: h.exchange || 'NSE', sector: h.sector || 'Other' };
        })
        .filter(Boolean);

      const marketValue = normalizedHoldings.reduce((s, n) => s + n.value, 0);
      const portfolioValue = msBalance + marketValue + localCashUsd;

      const byStock = normalizedHoldings.map(({ h, qty, price, cost, value, exchange }) => {
        const costBasis = qty * cost;
        const unrealizedPL = value - costBasis;
        return {
          symbol: h.symbol,
          name: h.name || h.symbol,
          value: parseFloat(value.toFixed(2)),
          valueKES: parseFloat((value * exchangeRate).toFixed(2)),
          percentage: portfolioValue > 0 ? parseFloat(((value / portfolioValue) * 100).toFixed(2)) : 0,
          quantity: Math.ceil(qty),   // int for Flutter model (ceil so 0.01 → 1, not 0)
          currentPrice: price,
          avgEntryPrice: parseFloat(cost.toFixed(8)),
          unrealizedPL: parseFloat(unrealizedPL.toFixed(2)),
          unrealizedPLPercent: costBasis > 0 ? parseFloat(((unrealizedPL / costBasis) * 100).toFixed(2)) : 0,
          exchange
        };
      });

      const bySector = Object.values(
        normalizedHoldings.reduce((acc, { sector, value }) => {
          if (!acc[sector]) acc[sector] = { name: sector, value: 0, valueKES: 0, percentage: 0, count: 0 };
          acc[sector].value += value;
          acc[sector].valueKES += value * exchangeRate;
          acc[sector].count += 1;
          return acc;
        }, {})
      ).map(s => ({ ...s, value: parseFloat(s.value.toFixed(2)), valueKES: parseFloat(s.valueKES.toFixed(2)), percentage: portfolioValue > 0 ? parseFloat(((s.value / portfolioValue) * 100).toFixed(2)) : 0 }));

      const byExchange = Object.values(
        normalizedHoldings.reduce((acc, { exchange, value }) => {
          if (!acc[exchange]) acc[exchange] = { name: exchange, value: 0, valueKES: 0, percentage: 0, count: 0 };
          acc[exchange].value += value;
          acc[exchange].valueKES += value * exchangeRate;
          acc[exchange].count += 1;
          return acc;
        }, {})
      ).map(e => ({ ...e, value: parseFloat(e.value.toFixed(2)), valueKES: parseFloat(e.valueKES.toFixed(2)), percentage: portfolioValue > 0 ? parseFloat(((e.value / portfolioValue) * 100).toFixed(2)) : 0 }));

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
            ...(marketValue > 0 ? [{ name: 'African Equities', value: parseFloat(marketValue.toFixed(2)), valueKES: parseFloat((marketValue * exchangeRate).toFixed(2)), percentage: portfolioValue > 0 ? parseFloat(((marketValue / portfolioValue) * 100).toFixed(2)) : 0, count: normalizedHoldings.length, stocks: byStock.map(s => s.symbol) }] : [])
          ],
          bySector,
          byStock,
          byExchange
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