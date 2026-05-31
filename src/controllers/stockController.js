const alpacaService = require('../services/alpacaService');
const ms = require('../services/mystocksService');
const logger = require('../utils/logger');
const { mapConditionCodes } = require('../utils/conditionCodes');
const { Watchlist, User, MsOrder, DemoOrder } = require('../models');
const Order = require('../models/Order');
const exchangeService = require('../services/exchangeService');
const axios = require('axios');
const { sequelize } = require('../config/database');

const AFRICAN_EXCHANGES = new Set(['NSE', 'NGX', 'JSE', 'GSE', 'BRVM', 'LUSE', 'EGX', 'BSE', 'SEM']);
const isAfrican = (exchange) => !!exchange && AFRICAN_EXCHANGES.has(exchange.toUpperCase());

const getQuote = async (req, res) => {
  const { symbol } = req.params;

  try {
    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: 'Stock symbol is required'
      });
    }

    // African exchange → MyStocks
    if (isAfrican(req.query.exchange)) {
      const stocks = await ms.getStocks({ exchange: req.query.exchange.toUpperCase(), search: symbol });
      const stock = Array.isArray(stocks) ? stocks[0] : stocks;
      if (!stock) return res.status(404).json({ success: false, message: 'Stock symbol not found' });
      return res.json({ success: true, provider: 'mystocks', quote: stock });
    }

    const quote = await alpacaService.getLatestQuote(symbol.toUpperCase());

    // Fetch asset details to get the company name for logo
    let assetName = null;
    try {
      const asset = await alpacaService.getAsset(symbol.toUpperCase());
      assetName = asset.name;
    } catch (assetError) {
      logger.debug(`Could not fetch asset name for ${symbol}:`, assetError.message);
    }

    res.json({
      success: true,
      quote: {
        symbol: symbol.toUpperCase(),
        name: assetName,
        logo: alpacaService.getCompanyLogo(symbol.toUpperCase(), assetName),
        askPrice: quote.ap,
        askSize: quote.as,
        bidPrice: quote.bp,
        bidSize: quote.bs,
        timestamp: quote.t,
        timeframe: quote.timeframe || 'realtime',
        conditions: mapConditionCodes(quote.c || [])
      }
    });
  } catch (error) {
    logger.error(`Get quote error for ${symbol}:`, error);

    if (error.message.includes('symbol not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'Stock symbol not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch stock quote'
    });
  }
};

const getLatestTrade = async (req, res) => {
  const { symbol } = req.params;

  try {

    const trade = await alpacaService.getLatestTrade(symbol.toUpperCase());

    // Fetch asset details to get the company name for logo
    let assetName = null;
    try {
      const asset = await alpacaService.getAsset(symbol.toUpperCase());
      assetName = asset.name;
    } catch (assetError) {
      logger.debug(`Could not fetch asset name for ${symbol}:`, assetError.message);
    }

    res.json({
      success: true,
      trade: {
        symbol: symbol.toUpperCase(),
        name: assetName,
        logo: alpacaService.getCompanyLogo(symbol.toUpperCase(), assetName),
        price: trade.p,
        size: trade.s,
        timestamp: trade.t,
        conditions: mapConditionCodes(trade.c || []),
        exchange: trade.x || ''
      }
    });
  } catch (error) {
    logger.error(`Get latest trade error for ${symbol}:`, error);

    if (error.message.includes('symbol not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'Stock symbol not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch latest trade'
    });
  }
};

const getBars = async (req, res) => {
  const { symbol } = req.params;

  try {
    const { timeframe = '1Day', start, end, limit = 100, exchange, range = '1M' } = req.query;

    // African symbol detected by .KE/.NG/.ZA etc. suffix → MyStocks
    if (isAfricanSymbol(symbol)) {
      const limitNum = Math.min(parseInt(limit), 1000);
      const msRange = (() => {
        if (['1Min', '5Min', '15Min', '30Min', '1Hour'].includes(timeframe)) return '1W';
        if (timeframe === '1Day') {
          if (limitNum <= 7) return '1W';
          if (limitNum <= 30) return '1M';
          if (limitNum <= 90) return '3M';
          return '1Y';
        }
        if (timeframe === '1Week') return '1Y';
        return '5Y';
      })();

      let stockName = symbol.toUpperCase();
      let stockLogo = `/api/v1/assets/logo/${symbol.toUpperCase()}`;
      let stockSnapshot = null;

      try {
        const ticker = symbol.includes('.') ? symbol.split('.')[0] : symbol;
        const snap = await ms.getStocks({ search: ticker });
        const stocks = Array.isArray(snap) ? snap : (Array.isArray(snap?.stocks) ? snap.stocks : []);
        stockSnapshot = stocks.find(s => s.symbol?.toUpperCase() === symbol.toUpperCase()) || stocks[0] || null;
        if (stockSnapshot?.name) stockName = stockSnapshot.name;
      } catch (_) {}

      let raw = null;
      try {
        raw = await ms.getStockHistory(symbol.toUpperCase(), msRange);
      } catch (_) {}

      const extractBars = (data) => {
        const arr = Array.isArray(data) ? data
          : (Array.isArray(data?.priceHistory) ? data.priceHistory
          : (Array.isArray(data?.history) ? data.history
          : (Array.isArray(data?.data) ? data.data
          : (Array.isArray(data?.prices) ? data.prices
          : (Array.isArray(data?.candles) ? data.candles : [])))));
        return arr.map(bar => ({
          timestamp: bar.date || bar.timestamp || bar.t,
          open: parseFloat(bar.open ?? bar.o ?? bar.price ?? 0),
          high: parseFloat(bar.high ?? bar.h ?? bar.price ?? 0),
          low: parseFloat(bar.low ?? bar.l ?? bar.price ?? 0),
          close: parseFloat(bar.close ?? bar.c ?? bar.price ?? 0),
          volume: parseInt(bar.volume ?? bar.v ?? 0),
          vwap: null,
          tradeCount: null
        }));
      };

      let bars = extractBars(raw);

      if (!bars.length && stockSnapshot?.name && stockSnapshot?.exchange) {
        try {
          const slug = ms.buildStockSlug(stockSnapshot.name, stockSnapshot.exchange);
          const pubRaw = await ms.getStockBySlug(slug);
          bars = extractBars(pubRaw);
          if (pubRaw?.logo?.imageUrl) stockLogo = pubRaw.logo.imageUrl;
        } catch (_) {}
      }

      if (!bars.length && stockSnapshot?.price) {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        bars = [
          { timestamp: yesterday, open: stockSnapshot.previousClose, high: stockSnapshot.previousClose, low: stockSnapshot.previousClose, close: stockSnapshot.previousClose, volume: 0, vwap: null, tradeCount: null },
          { timestamp: today, open: stockSnapshot.previousClose, high: stockSnapshot.dayHigh || stockSnapshot.price, low: stockSnapshot.dayLow || stockSnapshot.price, close: stockSnapshot.price, volume: stockSnapshot.volume || 0, vwap: null, tradeCount: null }
        ];
      }

      const sliced = bars.slice(-limitNum);

      // Check real + paper positions for this symbol
      let ownership = { hasPosition: false };
      try {
        const sym = symbol.toUpperCase();
        const [[realOrders, paperOrders], usdToLocal] = await Promise.all([
          Promise.all([
            MsOrder.findAll({ where: { user_id: req.user.id, symbol: sym } }),
            DemoOrder.findAll({ where: { user_id: req.user.id, symbol: sym } })
          ]),
          exchangeService.getExchangeRate('USD', stockSnapshot?.currency || 'KES').catch(() => null)
        ]);

        let realQty = 0;
        for (const o of realOrders) {
          if (o.side === 'BUY') realQty += parseFloat(o.quantity);
          else realQty -= parseFloat(o.quantity);
        }

        let paperQty = 0;
        for (const o of paperOrders) {
          if (o.side === 'BUY') paperQty += parseFloat(o.quantity);
          else paperQty -= parseFloat(o.quantity);
        }

        const currentPrice = stockSnapshot?.price ? parseFloat(stockSnapshot.price) : 0;

        // Real orders: local_price is already in local currency (KES); fallback to usd_price * rate
        let avgRealPrice = 0;
        if (realQty > 0.00001 && realOrders.length > 0) {
          const buyOrders = realOrders.filter(o => o.side === 'BUY');
          const totalCost = buyOrders.reduce((sum, o) => {
            const qty = parseFloat(o.quantity);
            const price = o.local_price
              ? parseFloat(o.local_price)
              : (parseFloat(o.usd_price || 0) * (usdToLocal || 1));
            return sum + price * qty;
          }, 0);
          const totalQty = buyOrders.reduce((sum, o) => sum + parseFloat(o.quantity), 0);
          avgRealPrice = totalQty > 0 ? totalCost / totalQty : 0;
        }

        // Paper orders: price_usd stored in USD — convert to local currency
        let avgPaperPrice = 0;
        if (paperQty > 0.00001 && paperOrders.length > 0) {
          const buyOrders = paperOrders.filter(o => o.side === 'BUY');
          const totalCost = buyOrders.reduce((sum, o) => {
            const qty = parseFloat(o.quantity);
            const price = parseFloat(o.price_usd || 0) * (usdToLocal || 1);
            return sum + price * qty;
          }, 0);
          const totalQty = buyOrders.reduce((sum, o) => sum + parseFloat(o.quantity), 0);
          avgPaperPrice = totalQty > 0 ? totalCost / totalQty : 0;
        }

        ownership = {
          hasPosition: realQty > 0.00001 || paperQty > 0.00001,
          realPosition: realQty > 0.00001 ? {
            quantity: parseFloat(realQty.toFixed(6)),
            averageEntryPrice: parseFloat(avgRealPrice.toFixed(4)),
            currentPrice,
            unrealizedPL: currentPrice > 0 ? parseFloat(((currentPrice - avgRealPrice) * realQty).toFixed(4)) : null,
            unrealizedPLPercent: currentPrice > 0 && avgRealPrice > 0 ? parseFloat((((currentPrice - avgRealPrice) / avgRealPrice) * 100).toFixed(2)) : null
          } : null,
          paperPosition: paperQty > 0.00001 ? {
            quantity: parseFloat(paperQty.toFixed(6)),
            averageEntryPrice: parseFloat(avgPaperPrice.toFixed(4)),
            currentPrice,
            unrealizedPL: currentPrice > 0 ? parseFloat(((currentPrice - avgPaperPrice) * paperQty).toFixed(4)) : null,
            unrealizedPLPercent: currentPrice > 0 && avgPaperPrice > 0 ? parseFloat((((currentPrice - avgPaperPrice) / avgPaperPrice) * 100).toFixed(2)) : null
          } : null
        };
      } catch (_) {}

      return res.json({
        success: true,
        provider: 'mystocks',
        symbol: symbol.toUpperCase(),
        name: stockName,
        logo: stockLogo,
        timeframe,
        bars: sliced,
        count: sliced.length,
        ownership
      });
    }

    // Validate timeframe
    const validTimeframes = ['1Min', '5Min', '15Min', '30Min', '1Hour', '1Day', '1Week', '1Month'];
    if (!validTimeframes.includes(timeframe)) {
      return res.status(400).json({
        success: false,
        message: `Invalid timeframe. Valid options: ${validTimeframes.join(', ')}`
      });
    }

    const bars = await alpacaService.getBars(
      symbol.toUpperCase(),
      timeframe,
      start,
      end,
      Math.min(parseInt(limit), 1000) // Cap at 1000 for performance
    );

    // Fetch asset details to get the company name for logo
    let assetName = null;
    try {
      const asset = await alpacaService.getAsset(symbol.toUpperCase());
      assetName = asset.name;
    } catch (assetError) {
      logger.debug(`Could not fetch asset name for ${symbol}:`, assetError.message);
    }

    const formattedBars = bars.map(bar => ({
      timestamp: bar.t,
      open: parseFloat(bar.o),
      high: parseFloat(bar.h),
      low: parseFloat(bar.l),
      close: parseFloat(bar.c),
      volume: parseInt(bar.v),
      vwap: bar.vw ? parseFloat(bar.vw) : null,
      tradeCount: bar.n || null
    }));

    // Check if user owns this asset
    let ownership = null;
    try {
      // Get user to find their Alpaca account ID
      const { User } = require('../models');
      const user = await User.findByPk(req.user.id);

      if (user && user.alpaca_account_id) {
        const positions = await alpacaService.getPositions(user.alpaca_account_id);
        const position = positions.find(pos => pos.symbol.toUpperCase() === symbol.toUpperCase());

        if (position) {
          ownership = {
            hasPosition: true,
            quantity: parseFloat(position.qty),
            marketValue: parseFloat(position.market_value),
            costBasis: parseFloat(position.cost_basis),
            unrealizedPL: parseFloat(position.unrealized_pl),
            unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100,
            averageEntryPrice: parseFloat(position.avg_entry_price),
            side: position.side
          };
        } else {
          ownership = {
            hasPosition: false
          };
        }
      } else {
        ownership = {
          hasPosition: false
        };
      }
    } catch (ownershipError) {
      logger.warn(`Could not check ownership for ${symbol}:`, ownershipError.message);
      ownership = {
        hasPosition: false
      };
    }

    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      name: assetName,
      logo: alpacaService.getCompanyLogo(symbol.toUpperCase(), assetName),
      timeframe,
      bars: formattedBars,
      count: formattedBars.length,
      ownership
    });
  } catch (error) {
    logger.error(`Get bars error for ${symbol}:`, error);

    if (error.message.includes('symbol not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'Stock symbol not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch price bars'
    });
  }
};

const getMultipleQuotes = async (req, res) => {
  try {
    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Symbols array is required'
      });
    }

    if (symbols.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 50 symbols allowed per request'
      });
    }

    const quotes = {};
    const errors = {};

    // Process symbols in parallel but with error handling for each
    await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const quote = await alpacaService.getLatestQuote(symbol.toUpperCase());
          quotes[symbol.toUpperCase()] = {
            askPrice: quote.ap,
            askSize: quote.as,
            bidPrice: quote.bp,
            bidSize: quote.bs,
            timestamp: quote.t,
            conditions: mapConditionCodes(quote.c || [])
          };
        } catch (error) {
          errors[symbol.toUpperCase()] = error.message;
        }
      })
    );

    res.json({
      success: true,
      quotes,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      count: Object.keys(quotes).length
    });
  } catch (error) {
    logger.error('Get multiple quotes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch multiple quotes'
    });
  }
};

const getMarketStatus = async (req, res) => {
  try {
    const marketStatus = await alpacaService.getMarketStatus();

    res.json({
      success: true,
      market: {
        isOpen: marketStatus.is_open,
        nextOpen: marketStatus.next_open,
        nextClose: marketStatus.next_close,
        timestamp: marketStatus.timestamp
      }
    });
  } catch (error) {
    logger.error('Get market status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch market status'
    });
  }
};

const getNews = async (req, res) => {
  try {
    // Support both 'symbol' and 'symbols' parameters
    const { symbol, symbols, limit = 10, start, end, exchange, page } = req.query;

    // African exchange → MyStocks market intel
    if (isAfrican(exchange)) {
      const data = await ms.getMarketIntel({ symbol, exchange: exchange.toUpperCase(), page, limit });
      return res.json({ success: true, provider: 'mystocks', data });
    }

    let symbolsArray;
    if (symbol) {
      // Single symbol provided
      symbolsArray = [symbol.toUpperCase().trim()];
    } else if (symbols) {
      // Multiple symbols provided (comma-separated)
      symbolsArray = symbols.split(',').map(s => s.toUpperCase().trim()).slice(0, 10); // Limit to 10 symbols
    }

    const news = await alpacaService.getNews(symbolsArray, Math.min(parseInt(limit), 50));

    const formattedNews = news.map(article => ({
      id: article.id,
      headline: article.headline,
      summary: article.summary,
      content: article.content,
      author: article.author,
      source: article.source,
      publishedAt: article.published_at,
      updatedAt: article.updated_at,
      url: article.url,
      symbols: article.symbols || [],
      images: article.images || []
    }));

    res.json({
      success: true,
      news: formattedNews,
      count: formattedNews.length,
      symbols: symbolsArray || 'general'
    });
  } catch (error) {
    logger.error('Get news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch market news'
    });
  }
};

const getNewsById = async (req, res) => {
  try {
    const { newsId } = req.params;

    if (!newsId) {
      return res.status(400).json({
        success: false,
        message: 'News ID is required'
      });
    }

    // Fetch all recent news (Alpaca doesn't have a direct "get by ID" endpoint)
    // So we fetch recent news and filter by ID
    const news = await alpacaService.getNews(null, 50); // Max limit allowed by Alpaca

    const article = news.find(item => item.id === newsId || item.id === parseInt(newsId));

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'News article not found'
      });
    }

    const formattedArticle = {
      id: article.id,
      headline: article.headline,
      summary: article.summary,
      content: article.content,
      author: article.author,
      source: article.source,
      publishedAt: article.published_at,
      updatedAt: article.updated_at,
      url: article.url,
      symbols: article.symbols || [],
      images: article.images || []
    };

    res.json({
      success: true,
      article: formattedArticle
    });
  } catch (error) {
    logger.error('Get news by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch news article'
    });
  }
};

const getMarketCalendar = async (req, res) => {
  try {
    const { start, end } = req.query;

    // Default to current month if no dates provided
    const defaultStart = start || new Date().toISOString().split('T')[0];
    const defaultEnd = end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const calendar = await alpacaService.getMarketCalendar(defaultStart, defaultEnd);

    const formattedCalendar = calendar.map(day => ({
      date: day.date,
      open: day.open,
      close: day.close,
      sessionOpen: day.session_open,
      sessionClose: day.session_close,
      settlementDate: day.settlement_date
    }));

    res.json({
      success: true,
      calendar: formattedCalendar,
      count: formattedCalendar.length,
      period: {
        start: defaultStart,
        end: defaultEnd
      }
    });
  } catch (error) {
    logger.error('Get market calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch market calendar'
    });
  }
};

const getStockFundamentals = async (req, res) => {
  const { symbol } = req.params;

  try {

    // Get basic asset information
    const asset = await alpacaService.getAsset(symbol.toUpperCase());

    // Get recent price data for basic metrics
    const bars = await alpacaService.getBars(symbol.toUpperCase(), '1Day', null, null, 252); // ~1 year of data
    const latestQuote = await alpacaService.getLatestQuote(symbol.toUpperCase());

    let metrics = null;
    if (bars.length > 0) {
      const prices = bars.map(bar => parseFloat(bar.c));
      const latestPrice = latestQuote.ap || latestQuote.bp || prices[prices.length - 1];

      // Calculate basic technical indicators
      const sma20 = calculateSMA(prices.slice(-20), 20);
      const sma50 = calculateSMA(prices.slice(-50), 50);
      const sma200 = calculateSMA(prices.slice(-200), 200);

      metrics = {
        currentPrice: latestPrice,
        change: prices.length > 1 ? latestPrice - prices[prices.length - 2] : 0,
        changePercent: prices.length > 1 ? ((latestPrice - prices[prices.length - 2]) / prices[prices.length - 2] * 100) : 0,
        dayRange: {
          high: Math.max(...prices.slice(-1)),
          low: Math.min(...prices.slice(-1))
        },
        fiftyTwoWeekRange: {
          high: Math.max(...prices),
          low: Math.min(...prices)
        },
        movingAverages: {
          sma20,
          sma50,
          sma200
        },
        volume: bars[bars.length - 1]?.v || 0
      };
    }

    res.json({
      success: true,
      stock: {
        symbol: symbol.toUpperCase(),
        name: asset.name,
        exchange: asset.exchange,
        assetClass: asset.class,
        status: asset.status,
        tradable: asset.tradable,
        marginable: asset.marginable,
        shortable: asset.shortable,
        easyToBorrow: asset.easy_to_borrow,
        fractionable: asset.fractionable,
        metrics
      }
    });
  } catch (error) {
    logger.error(`Get stock fundamentals error for ${symbol}:`, error);

    if (error.message.includes('symbol not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'Stock symbol not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch stock fundamentals'
    });
  }
};

// Helper function to calculate Simple Moving Average
const calculateSMA = (prices, period) => {
  if (prices.length < period) return null;

  const sum = prices.slice(-period).reduce((acc, price) => acc + price, 0);
  return sum / period;
};

const getAllWatchlists = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch user's watchlist from database (limited to one per user)
    const watchlist = await Watchlist.findOne({ where: { user_id: userId } });

    if (!watchlist) {
      return res.json({
        success: true,
        watchlists: [],
        count: 0
      });
    }

    res.json({
      success: true,
      watchlists: [{
        id: watchlist.id,
        alpacaWatchlistId: watchlist.alpaca_watchlist_id,
        name: watchlist.name,
        symbolCount: watchlist.symbols.length,
        symbols: watchlist.symbols,
        createdAt: watchlist.created_at,
        updatedAt: watchlist.updated_at
      }],
      count: 1
    });
  } catch (error) {
    logger.error('Get all watchlists error:', error);
    res.status(500).json({
      success: false,
      message: 'We encountered an issue while loading your watchlists. Please try again in a moment.'
    });
  }
};

// African symbols have an exchange suffix: ABSA.KE, EQTY.KE, ACCESS.NG, etc.
const isAfricanSymbol = (sym) => /\.[A-Z]{2,3}$/.test(sym);
const partitionSymbols = (syms) => {
  const upper = syms.map(s => s.toUpperCase());
  return {
    us: upper.filter(s => !isAfricanSymbol(s)),
    african: upper.filter(s => isAfricanSymbol(s)),
    all: upper
  };
};

const manageWatchlist = async (req, res) => {
  try {
    const { name, symbols, addSymbol, removeSymbol, delete: deleteWatchlist } = req.body;
    const userId = req.user.id;

    const existingWatchlist = await Watchlist.findOne({ where: { user_id: userId } });
    if (deleteWatchlist === true) {
      if (!existingWatchlist) {
        return res.status(404).json({
          success: false,
          message: 'You don\'t have a watchlist to delete.'
        });
      }

      try {
        // Try to delete from Alpaca
        await alpacaService.deleteWatchlist(existingWatchlist.alpaca_watchlist_id);
      } catch (alpacaError) {
        // If Alpaca watchlist not found, just log warning and continue with DB deletion
        if (alpacaError.message.includes('not found') || alpacaError.message.includes('404')) {
          logger.warn(`Alpaca watchlist ${existingWatchlist.alpaca_watchlist_id} already deleted or not found`);
        } else {
          throw alpacaError; // Re-throw other errors
        }
      }

      await existingWatchlist.destroy();

      return res.json({
        success: true,
        message: 'Watchlist deleted successfully.'
      });
    }

    if (addSymbol) {
      if (!existingWatchlist) {
        return res.status(404).json({
          success: false,
          message: 'You don\'t have a watchlist yet. Create one first by providing name and symbols.'
        });
      }

      if (existingWatchlist.symbols.includes(addSymbol.toUpperCase())) {
        return res.status(400).json({
          success: false,
          message: `${addSymbol} is already in your watchlist.`
        });
      }

      const symbolUpper = addSymbol.toUpperCase();
      const updatedSymbols = [...existingWatchlist.symbols, symbolUpper];

      // Only sync non-African symbols to Alpaca
      if (!isAfricanSymbol(symbolUpper) && existingWatchlist.alpaca_watchlist_id) {
        try {
          await alpacaService.addSymbolToWatchlist(existingWatchlist.alpaca_watchlist_id, symbolUpper);
        } catch (alpacaError) {
          if (!alpacaError.message.includes('not found') && !alpacaError.message.includes('404')) {
            throw alpacaError;
          }
          logger.warn(`Alpaca watchlist ${existingWatchlist.alpaca_watchlist_id} not found, skipping Alpaca sync`);
        }
      }

      await existingWatchlist.update({ symbols: updatedSymbols });

      return res.json({
        success: true,
        message: `${addSymbol} added to watchlist successfully.`,
        data: {
          id: existingWatchlist.id,
          name: existingWatchlist.name,
          symbols: updatedSymbols,
          createdAt: existingWatchlist.created_at,
          updatedAt: existingWatchlist.updated_at
        }
      });
    }

    if (removeSymbol) {
      if (!existingWatchlist) {
        return res.status(404).json({
          success: false,
          message: 'You don\'t have a watchlist yet.'
        });
      }

      const symbolUpper = removeSymbol.toUpperCase();

      if (!existingWatchlist.symbols.includes(symbolUpper)) {
        return res.status(404).json({
          success: false,
          message: `${symbolUpper} is not in your watchlist.`
        });
      }

      // Only sync removal to Alpaca for non-African symbols
      if (!isAfricanSymbol(symbolUpper) && existingWatchlist.alpaca_watchlist_id) {
        try {
          await alpacaService.removeSymbolFromWatchlist(existingWatchlist.alpaca_watchlist_id, symbolUpper);
        } catch (alpacaError) {
          if (!alpacaError.message.includes('not found') && !alpacaError.message.includes('404')) {
            throw alpacaError;
          }
          logger.warn(`Alpaca watchlist ${existingWatchlist.alpaca_watchlist_id} not found, skipping Alpaca sync`);
        }
      }

      const updatedSymbols = existingWatchlist.symbols.filter(s => s !== symbolUpper);
      await existingWatchlist.update({ symbols: updatedSymbols });

      return res.json({
        success: true,
        message: `${symbolUpper} removed from watchlist successfully.`,
        data: {
          id: existingWatchlist.id,
          name: existingWatchlist.name,
          symbols: updatedSymbols,
          createdAt: existingWatchlist.created_at,
          updatedAt: existingWatchlist.updated_at
        }
      });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a name for your watchlist.'
      });
    }

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({
        success: false,
        message: 'Symbols must be provided as an array.'
      });
    }

    if (symbols.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one symbol.'
      });
    }

    if (existingWatchlist) {
      // Split so African symbols bypass Alpaca; existing US symbols still sync normally
      const { us: usSymbols, all: allSymbols } = partitionSymbols(symbols);
      let alpacaWatchlist;

      if (usSymbols.length > 0) {
        try {
          // Try to update in Alpaca with US-only symbols
          alpacaWatchlist = await alpacaService.updateWatchlist(
            existingWatchlist.alpaca_watchlist_id,
            name.trim(),
            usSymbols
          );
        } catch (alpacaError) {
          // If Alpaca watchlist not found (404), recreate it
          if (alpacaError.message.includes('not found') || alpacaError.message.includes('404')) {
            logger.warn(`Alpaca watchlist ${existingWatchlist.alpaca_watchlist_id} not found. Recreating...`);

            // Recreate watchlist in Alpaca with US symbols only
            alpacaWatchlist = await alpacaService.createWatchlist(name.trim(), usSymbols);

            // Update database with new Alpaca ID and ALL symbols (US + African)
            await existingWatchlist.update({
              alpaca_watchlist_id: alpacaWatchlist.id,
              name: alpacaWatchlist.name,
              symbols: allSymbols
            });

            return res.json({
              success: true,
              message: 'Watchlist updated successfully.',
              data: {
                id: existingWatchlist.id,
                name: existingWatchlist.name,
                symbols: existingWatchlist.symbols,
                createdAt: existingWatchlist.created_at,
                updatedAt: existingWatchlist.updated_at
              }
            });
          }
          throw alpacaError; // Re-throw other errors
        }
      }

      // Update in database with ALL symbols (US + African)
      await existingWatchlist.update({
        name: alpacaWatchlist ? alpacaWatchlist.name : name.trim(),
        symbols: allSymbols
      });

      return res.json({
        success: true,
        message: 'Watchlist updated successfully.',
        data: {
          id: existingWatchlist.id,
          name: existingWatchlist.name,
          symbols: existingWatchlist.symbols,
          createdAt: existingWatchlist.created_at,
          updatedAt: existingWatchlist.updated_at
        }
      });
    }

    const { us: usSymbols, all: allSymbols } = partitionSymbols(symbols);

    let alpacaWatchlistId = null;

    if (usSymbols.length > 0) {
      try {
        const existingAlpacaWatchlists = await alpacaService.getAllWatchlists();
        if (existingAlpacaWatchlists && existingAlpacaWatchlists.length > 0) {
          for (const wl of existingAlpacaWatchlists) {
            await alpacaService.deleteWatchlist(wl.id);
          }
        }
      } catch (cleanupError) {
        logger.warn('Error cleaning up old watchlists:', cleanupError.message);
      }

      try {
        const alpacaWatchlist = await alpacaService.createWatchlist(name.trim(), usSymbols);
        alpacaWatchlistId = alpacaWatchlist.id;
      } catch (alpacaError) {
        logger.warn('Failed to create Alpaca watchlist, saving to DB only:', alpacaError.message);
      }
    }

    const dbWatchlist = await Watchlist.create({
      user_id: userId,
      alpaca_watchlist_id: alpacaWatchlistId,
      name: name.trim(),
      symbols: allSymbols
    });

    return res.status(201).json({
      success: true,
      message: `Watchlist "${name}" created successfully.`,
      data: {
        id: dbWatchlist.id,
        name: dbWatchlist.name,
        symbols: dbWatchlist.symbols,
        createdAt: dbWatchlist.created_at,
        updatedAt: dbWatchlist.updated_at
      }
    });

  } catch (error) {
    logger.error('Manage watchlist error:', error);

    if (error.message.includes('already exists') || error.message.includes('must be unique')) {
      return res.status(400).json({
        success: false,
        message: 'A watchlist with this name already exists.'
      });
    }

    if (error.message.includes('not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'Watchlist or symbol not found.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'We encountered an issue. Please try again in a moment.'
    });
  }
};


const createWatchlist = async (req, res) => {
  try {
    const { name, symbols } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a name for your watchlist.'
      });
    }

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({
        success: false,
        message: 'Symbols must be provided as an array.'
      });
    }

    // Check if user already has a watchlist in database (one watchlist per user limit)
    const existingWatchlist = await Watchlist.findOne({ where: { user_id: userId } });

    if (existingWatchlist) {
      return res.status(400).json({
        success: false,
        message: 'You can only have one watchlist. Please update your existing watchlist instead.',
        existingWatchlist: {
          id: existingWatchlist.id,
          name: existingWatchlist.name
        }
      });
    }

    // Clean up any existing Alpaca watchlists (from before database storage was implemented)
    try {
      const existingAlpacaWatchlists = await alpacaService.getAllWatchlists();
      if (existingAlpacaWatchlists && existingAlpacaWatchlists.length > 0) {
        logger.info(`Found ${existingAlpacaWatchlists.length} existing Alpaca watchlists. Cleaning up...`);
        for (const wl of existingAlpacaWatchlists) {
          await alpacaService.deleteWatchlist(wl.id);
          logger.info(`Deleted old Alpaca watchlist: ${wl.id} (${wl.name})`);
        }
      }
    } catch (cleanupError) {
      logger.warn('Error cleaning up old watchlists:', cleanupError.message);
      // Continue with creation even if cleanup fails
    }

    // Create watchlist in Alpaca
    const alpacaWatchlist = await alpacaService.createWatchlist(name.trim(), symbols);

    // Save to database
    const dbWatchlist = await Watchlist.create({
      user_id: userId,
      alpaca_watchlist_id: alpacaWatchlist.id,
      name: alpacaWatchlist.name,
      symbols: alpacaWatchlist.assets.map(a => a.symbol)
    });

    res.status(201).json({
      success: true,
      message: `Watchlist "${name}" created successfully.`,
      watchlist: {
        id: dbWatchlist.id,
        alpacaWatchlistId: dbWatchlist.alpaca_watchlist_id,
        name: dbWatchlist.name,
        symbols: dbWatchlist.symbols,
        createdAt: dbWatchlist.created_at,
        updatedAt: dbWatchlist.updated_at
      }
    });
  } catch (error) {
    logger.error('Create watchlist error:', error);

    if (error.message.includes('already exists') || error.message.includes('must be unique')) {
      return res.status(400).json({
        success: false,
        message: 'A watchlist with this name already exists. Please choose a different name or try again.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'We encountered an issue while creating your watchlist. Please try again in a moment.'
    });
  }
};

const getWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;
    const userId = req.user.id;

    let dbWatchlist;

    if (watchlistId) {
      dbWatchlist = await Watchlist.findOne({
        where: {
          id: watchlistId,
          user_id: userId
        }
      });
    } else {
      // Fetch user's single watchlist
      dbWatchlist = await Watchlist.findOne({ where: { user_id: userId } });
    }

    if (!dbWatchlist) {
      return res.status(404).json({
        success: false,
        message: 'You don\'t have a watchlist yet. Create one to get started.'
      });
    }

    const allSymbols = dbWatchlist.symbols || [];
    const usSymbols = allSymbols.filter(s => !isAfricanSymbol(s));
    const africanSymbols = allSymbols.filter(s => isAfricanSymbol(s));

    // --- US assets from Alpaca ---
    let alpacaAssets = [];
    let watchlistName = dbWatchlist.name;

    if (usSymbols.length > 0) {
      const recreateAlpacaWatchlist = async () => {
        let newWl;
        try {
          newWl = await alpacaService.createWatchlist(dbWatchlist.name, usSymbols);
        } catch (createError) {
          if (createError.message && createError.message.includes('watchlist name must be unique')) {
            logger.warn(`Watchlist name "${dbWatchlist.name}" already exists in Alpaca. Cleaning up...`);
            const allWatchlists = await alpacaService.getAllWatchlists();
            for (const w of allWatchlists.filter(w => w.name === dbWatchlist.name)) {
              await alpacaService.deleteWatchlist(w.id);
            }
            newWl = await alpacaService.createWatchlist(dbWatchlist.name, usSymbols);
          } else {
            throw createError;
          }
        }
        await dbWatchlist.update({ alpaca_watchlist_id: newWl.id });
        logger.info(`Alpaca watchlist created/restored: ${newWl.id}`);
        return newWl.id;
      };

      try {
        let alpacaData;
        if (!dbWatchlist.alpaca_watchlist_id) {
          const newId = await recreateAlpacaWatchlist();
          alpacaData = await alpacaService.getWatchlistWithMarketData(newId);
        } else {
          try {
            alpacaData = await alpacaService.getWatchlistWithMarketData(dbWatchlist.alpaca_watchlist_id);
          } catch (alpacaError) {
            logger.warn(`Stale Alpaca watchlist, recovering: ${alpacaError.message}`);
            const newId = await recreateAlpacaWatchlist();
            alpacaData = await alpacaService.getWatchlistWithMarketData(newId);
          }
        }
        alpacaAssets = alpacaData.assets || [];
        watchlistName = alpacaData.name || dbWatchlist.name;
      } catch (err) {
        logger.error('Failed to fetch US watchlist assets from Alpaca:', err.message);
      }
    }

    // --- African assets from MyStocks ---
    const africanAssets = await Promise.all(africanSymbols.map(async (symbol) => {
      try {
        const ticker = symbol.includes('.') ? symbol.split('.')[0] : symbol;
        const snap = await ms.getStocks({ search: ticker });
        const stocks = Array.isArray(snap) ? snap : (Array.isArray(snap?.stocks) ? snap.stocks : []);
        const stock = stocks.find(s => s.symbol?.toUpperCase() === symbol.toUpperCase()) || stocks[0];
        if (!stock) throw new Error('symbol not found');

        const currentPrice = stock.price || 0;
        const previousClose = stock.previousClose || currentPrice;
        const change = currentPrice - previousClose;
        const changePercent = previousClose ? (change / previousClose) * 100 : 0;

        return {
          symbol,
          name: stock.name || symbol,
          logo: `/api/v1/assets/logo/${symbol}`,
          exchange: stock.exchange || symbol.split('.').pop() || 'NSE',
          assetClass: 'african_equity',
          status: 'active',
          tradable: false,
          marginable: false,
          shortable: false,
          easyToBorrow: false,
          fractionable: false,
          marketData: {
            currentPrice,
            change,
            changePercent,
            volume: stock.volume || 0,
            high: stock.dayHigh || currentPrice,
            low: stock.dayLow || currentPrice,
            lastUpdated: new Date().toISOString(),
            isProfit: change >= 0
          }
        };
      } catch (err) {
        logger.warn(`Failed to get MyStocks data for ${symbol}: ${err.message}`);
        return {
          symbol,
          name: symbol,
          logo: `/api/v1/assets/logo/${symbol}`,
          exchange: symbol.split('.').pop() || 'NSE',
          assetClass: 'african_equity',
          status: 'active',
          tradable: false,
          marginable: false,
          shortable: false,
          easyToBorrow: false,
          fractionable: false,
          marketData: {
            currentPrice: 0, change: 0, changePercent: 0,
            volume: 0, high: 0, low: 0,
            lastUpdated: new Date().toISOString(),
            isProfit: false
          }
        };
      }
    }));

    const assets = [...alpacaAssets, ...africanAssets];

    res.json({
      success: true,
      watchlist: {
        id: dbWatchlist.id,
        alpacaWatchlistId: dbWatchlist.alpaca_watchlist_id,
        name: watchlistName,
        assets,
        count: assets.length,
        createdAt: dbWatchlist.created_at,
        updatedAt: dbWatchlist.updated_at
      }
    });
  } catch (error) {
    logger.error('Get watchlist error:', error);

    if (error.message.includes('not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist. It may have been deleted.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'We encountered an issue while loading your watchlist. Please try again in a moment.'
    });
  }
};

const updateWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;
    const { name, symbols } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a name for your watchlist.'
      });
    }

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({
        success: false,
        message: 'Symbols must be provided as an array.'
      });
    }

    // Find user's watchlist
    let dbWatchlist;
    if (watchlistId) {
      dbWatchlist = await Watchlist.findOne({
        where: {
          id: watchlistId,
          user_id: userId
        }
      });
    } else {
      dbWatchlist = await Watchlist.findOne({ where: { user_id: userId } });
    }

    if (!dbWatchlist) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist. It may have been deleted.'
      });
    }

    const allSymbols = symbols.map(s => s.toUpperCase());
    const usSymbols = allSymbols.filter(s => !isAfricanSymbol(s));

    if (usSymbols.length > 0) {
      if (!dbWatchlist.alpaca_watchlist_id) {
        const newWl = await alpacaService.createWatchlist(name.trim(), usSymbols);
        await dbWatchlist.update({ alpaca_watchlist_id: newWl.id, name: name.trim(), symbols: allSymbols });
      } else {
        await alpacaService.updateWatchlist(dbWatchlist.alpaca_watchlist_id, name.trim(), usSymbols);
        await dbWatchlist.update({ name: name.trim(), symbols: allSymbols });
      }
    } else {
      // African-only — clear Alpaca watchlist if one exists
      if (dbWatchlist.alpaca_watchlist_id) {
        try { await alpacaService.deleteWatchlist(dbWatchlist.alpaca_watchlist_id); } catch (_) {}
        await dbWatchlist.update({ alpaca_watchlist_id: null, name: name.trim(), symbols: allSymbols });
      } else {
        await dbWatchlist.update({ name: name.trim(), symbols: allSymbols });
      }
    }

    await dbWatchlist.reload();

    res.json({
      success: true,
      message: 'Watchlist updated successfully.',
      watchlist: {
        id: dbWatchlist.id,
        alpacaWatchlistId: dbWatchlist.alpaca_watchlist_id,
        name: dbWatchlist.name,
        symbols: dbWatchlist.symbols,
        updatedAt: dbWatchlist.updated_at
      }
    });
  } catch (error) {
    logger.error('Update watchlist error:', error);

    if (error.message.includes('not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist. It may have been deleted.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'We encountered an issue while updating your watchlist. Please try again in a moment.'
    });
  }
};

const addSymbolToWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;
    const { symbol } = req.body;
    const userId = req.user.id;

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid stock symbol.'
      });
    }

    // Find user's watchlist
    let dbWatchlist;
    if (watchlistId) {
      dbWatchlist = await Watchlist.findOne({
        where: {
          id: watchlistId,
          user_id: userId
        }
      });
    } else {
      dbWatchlist = await Watchlist.findOne({ where: { user_id: userId } });
    }

    if (!dbWatchlist) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist. It may have been deleted.'
      });
    }

    const symbolUpper = symbol.toUpperCase();
    const currentSymbols = dbWatchlist.symbols || [];

    if (currentSymbols.includes(symbolUpper)) {
      return res.status(400).json({
        success: false,
        message: 'This symbol is already in your watchlist.'
      });
    }

    const updatedSymbols = [...currentSymbols, symbolUpper];

    if (isAfricanSymbol(symbolUpper)) {
      // African symbol — DB only, no Alpaca
      await dbWatchlist.update({ symbols: updatedSymbols });
    } else {
      // US symbol — sync with Alpaca
      if (!dbWatchlist.alpaca_watchlist_id) {
        const usSymbols = updatedSymbols.filter(s => !isAfricanSymbol(s));
        const newWl = await alpacaService.createWatchlist(dbWatchlist.name, usSymbols);
        await dbWatchlist.update({ alpaca_watchlist_id: newWl.id, symbols: updatedSymbols });
      } else {
        await alpacaService.addSymbolToWatchlist(dbWatchlist.alpaca_watchlist_id, symbolUpper);
        await dbWatchlist.update({ symbols: updatedSymbols });
      }
    }

    await dbWatchlist.reload();

    res.json({
      success: true,
      message: `${symbolUpper} added to your watchlist successfully.`,
      watchlist: {
        id: dbWatchlist.id,
        alpacaWatchlistId: dbWatchlist.alpaca_watchlist_id,
        name: dbWatchlist.name,
        symbols: dbWatchlist.symbols,
        updatedAt: dbWatchlist.updated_at
      }
    });
  } catch (error) {
    logger.error('Add symbol to watchlist error:', error);

    if (error.message.includes('not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist. It may have been deleted.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'We encountered an issue while adding the symbol. Please try again in a moment.'
    });
  }
};

const removeSymbolFromWatchlist = async (req, res) => {
  try {
    const { watchlistId, symbol } = req.params;
    const userId = req.user.id;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: 'Symbol is required.'
      });
    }

    // Find user's watchlist
    let dbWatchlist;
    if (watchlistId) {
      dbWatchlist = await Watchlist.findOne({
        where: {
          id: watchlistId,
          user_id: userId
        }
      });
    } else {
      dbWatchlist = await Watchlist.findOne({ where: { user_id: userId } });
    }

    if (!dbWatchlist) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist.'
      });
    }

    // Remove from Alpaca
    const alpacaWatchlist = await alpacaService.removeSymbolFromWatchlist(
      dbWatchlist.alpaca_watchlist_id,
      symbol
    );

    // Update database
    await dbWatchlist.update({
      symbols: alpacaWatchlist.assets.map(a => a.symbol)
    });

    res.json({
      success: true,
      message: `${symbol.toUpperCase()} removed from your watchlist successfully.`,
      watchlist: {
        id: dbWatchlist.id,
        alpacaWatchlistId: dbWatchlist.alpaca_watchlist_id,
        name: dbWatchlist.name,
        symbols: dbWatchlist.symbols,
        updatedAt: dbWatchlist.updated_at
      }
    });
  } catch (error) {
    logger.error('Remove symbol from watchlist error:', error);

    if (error.message.includes('not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist or symbol.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'We encountered an issue while removing the symbol. Please try again in a moment.'
    });
  }
};

const deleteWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;
    const userId = req.user.id;

    // Find user's watchlist
    let dbWatchlist;
    if (watchlistId) {
      dbWatchlist = await Watchlist.findOne({
        where: {
          id: watchlistId,
          user_id: userId
        }
      });
    } else {
      dbWatchlist = await Watchlist.findOne({ where: { user_id: userId } });
    }

    if (!dbWatchlist) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist. It may have already been deleted.'
      });
    }

    // Delete from Alpaca
    await alpacaService.deleteWatchlist(dbWatchlist.alpaca_watchlist_id);

    // Delete from database
    await dbWatchlist.destroy();

    res.json({
      success: true,
      message: 'Watchlist deleted successfully.'
    });
  } catch (error) {
    logger.error('Delete watchlist error:', error);

    if (error.message.includes('not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'We couldn\'t find this watchlist. It may have already been deleted.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'We encountered an issue while deleting your watchlist. Please try again in a moment.'
    });
  }
};

const getTopMovers = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);
    const { exchange } = req.query;

    if (limit < 1) {
      return res.status(400).json({ success: false, message: 'Limit must be between 1 and 20.' });
    }

    const byChange = (a, b) => (b.changePct ?? b.change ?? 0) - (a.changePct ?? a.change ?? 0);

    const getMsMovers = async (exch) => {
      const data = await ms.getStocks({ exchange: exch });
      const all = Array.isArray(data) ? data : (Array.isArray(data?.stocks) ? data.stocks : []);
      const withChange = all.filter(s => s.changePct != null || s.change != null);
      return {
        gainers: [...withChange].sort(byChange).slice(0, limit).map(s => ({ ...s, provider: 'mystocks', exchange: exch })),
        losers: [...withChange].sort((a, b) => byChange(b, a)).slice(0, limit).map(s => ({ ...s, provider: 'mystocks', exchange: exch }))
      };
    };

    // African-specific exchange → MyStocks only
    if (isAfrican(exchange)) {
      const msMovers = await getMsMovers(exchange.toUpperCase());
      return res.json({
        success: true,
        provider: 'mystocks',
        exchange: exchange.toUpperCase(),
        data: { ...msMovers, lastUpdated: new Date().toISOString() },
        count: { gainers: msMovers.gainers.length, losers: msMovers.losers.length }
      });
    }

    // No exchange → fetch Alpaca + MyStocks NSE in parallel and merge
    const [movers, msMovers, marketStatus] = await Promise.all([
      alpacaService.getTopMovers(limit),
      getMsMovers('NSE').catch(e => { logger.warn('MyStocks movers error:', e.message); return { gainers: [], losers: [] }; }),
      alpacaService.getMarketStatus().catch(() => ({ is_open: false, next_open: null, next_close: null }))
    ]);

    const alpacaGainers = movers.gainers.map(s => ({ ...s, provider: 'alpaca' }));
    const alpacaLosers  = movers.losers.map(s => ({ ...s, provider: 'alpaca' }));

    if (!marketStatus.is_open) {
      marketStatus.message = 'Market closed. Showing data from last trading session';
    } else {
      marketStatus.message = 'Market is open. Showing live data';
    }

    res.json({
      success: true,
      data: {
        gainers: [...alpacaGainers, ...msMovers.gainers],
        losers:  [...alpacaLosers,  ...msMovers.losers],
        lastUpdated: movers.lastUpdated
      },
      marketStatus: {
        isOpen: marketStatus.is_open,
        message: marketStatus.message,
        nextOpen: marketStatus.next_open,
        nextClose: marketStatus.next_close
      },
      count: {
        gainers: alpacaGainers.length + msMovers.gainers.length,
        losers:  alpacaLosers.length  + msMovers.losers.length
      }
    });
  } catch (error) {
    logger.error('Get top movers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top movers. Please try again in a moment.'
    });
  }
};

const getUpcomingEvents = async (req, res) => {
  try {
    const daysAhead = parseInt(req.query.days) || 7;

    if (daysAhead < 1 || daysAhead > 30) {
      return res.status(400).json({
        success: false,
        message: 'Days must be between 1 and 30.'
      });
    }

    const eventsData = await alpacaService.getUpcomingEvents(daysAhead);

    res.json({
      success: true,
      data: eventsData.events,
      meta: {
        startDate: eventsData.startDate,
        endDate: eventsData.endDate,
        count: eventsData.count
      }
    });
  } catch (error) {
    logger.error('Get upcoming events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming events. Please try again in a moment.'
    });
  }
};

const getStockChart = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { timeframe = '1Day', limit = 30, chartType = 'line' } = req.query;

    // Validate inputs
    const validTimeframes = ['1Min', '5Min', '15Min', '30Min', '1Hour', '1Day', '1Week', '1Month'];
    if (!validTimeframes.includes(timeframe)) {
      return res.status(400).json({
        success: false,
        message: `Invalid timeframe. Valid options: ${validTimeframes.join(', ')}`
      });
    }

    const validChartTypes = ['line', 'candlestick', 'bar'];
    if (!validChartTypes.includes(chartType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid chart type. Valid options: ${validChartTypes.join(', ')}`
      });
    }

    const limitNum = Math.min(parseInt(limit), 100);

    // MyStocks path for African symbols (e.g. ABSA.KE, DANGCEM.NG)
    if (isAfricanSymbol(symbol)) {
      const msRange = (() => {
        if (['1Min', '5Min', '15Min', '30Min', '1Hour'].includes(timeframe)) return '1W';
        if (timeframe === '1Day') {
          if (limitNum <= 7) return '1W';
          if (limitNum <= 30) return '1M';
          if (limitNum <= 90) return '3M';
          return '1Y';
        }
        if (timeframe === '1Week') return '1Y';
        return '5Y';
      })();

      let raw;
      let stockName = symbol.toUpperCase();

      // Step 1: fetch stock snapshot — needed for name resolution and slug building
      let stockSnapshot = null;
      try {
        const ticker = symbol.includes('.') ? symbol.split('.')[0] : symbol;
        const snap = await ms.getStocks({ search: ticker });
        const stocks = Array.isArray(snap) ? snap : (Array.isArray(snap?.stocks) ? snap.stocks : []);
        stockSnapshot = stocks.find(s => s.symbol?.toUpperCase() === symbol.toUpperCase()) || stocks[0] || null;
        if (stockSnapshot?.name) stockName = stockSnapshot.name;
      } catch (_) { /* best-effort */ }

      // Step 2: try partner history endpoint (works in production)
      try {
        raw = await ms.getStockHistory(symbol.toUpperCase(), msRange);
      } catch (e) {
        logger.warn(`MyStocks partner history unavailable for ${symbol}, trying public API: ${e.message}`);
        raw = null;
      }

      const normalizeBar = (bar) => {
        // { date, price } from public priceHistory → treat price as close
        if (bar.price !== undefined && bar.open === undefined) {
          return { date: bar.date, open: bar.price, high: bar.price, low: bar.price, close: bar.price, volume: 0 };
        }
        return bar;
      };

      const extractHistory = (data) => {
        const arr = Array.isArray(data) ? data
          : (Array.isArray(data?.priceHistory) ? data.priceHistory
          : (Array.isArray(data?.history) ? data.history
          : (Array.isArray(data?.data) ? data.data
          : (Array.isArray(data?.prices) ? data.prices
          : (Array.isArray(data?.candles) ? data.candles
          : (Array.isArray(data?.ohlcv) ? data.ohlcv
          : []))))));
        return arr.map(normalizeBar);
      };

      let history = extractHistory(raw);
      let stockLogo = `/api/v1/assets/logo/${symbol.toUpperCase()}`;

      // Step 3: try public web API using slug (works in sandbox + production)
      if (!history.length && stockSnapshot?.name && stockSnapshot?.exchange) {
        try {
          const slug = ms.buildStockSlug(stockSnapshot.name, stockSnapshot.exchange);
          const pubRaw = await ms.getStockBySlug(slug);
          history = extractHistory(pubRaw);
          // Use real logo URL from public API if available
          if (pubRaw?.logo?.imageUrl) stockLogo = pubRaw.logo.imageUrl;
          logger.info(`MyStocks public API chart fetched via slug: ${slug}, ${history.length} points`);
        } catch (slugErr) {
          logger.warn(`MyStocks public slug fallback failed for ${symbol}: ${slugErr.message}`);
        }
      }

      // Step 4: last resort — 2-point snapshot chart from current price data
      if (!history.length && stockSnapshot?.price) {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        history = [
          { date: yesterday, open: stockSnapshot.previousClose, high: stockSnapshot.previousClose, low: stockSnapshot.previousClose, close: stockSnapshot.previousClose, volume: 0 },
          { date: today,     open: stockSnapshot.previousClose, high: stockSnapshot.dayHigh || stockSnapshot.price, low: stockSnapshot.dayLow || stockSnapshot.price, close: stockSnapshot.price, volume: stockSnapshot.volume || 0 }
        ];
      }

      if (!history.length) {
        return res.status(404).json({
          success: false,
          message: 'No chart data available for this symbol.'
        });
      }

      const chartData = history.slice(-limitNum).map(bar => ({
        timestamp: bar.date || bar.timestamp || bar.t,
        open: parseFloat(bar.open ?? bar.o ?? 0),
        high: parseFloat(bar.high ?? bar.h ?? 0),
        low: parseFloat(bar.low ?? bar.l ?? 0),
        close: parseFloat(bar.close ?? bar.c ?? 0),
        volume: parseInt(bar.volume ?? bar.v ?? 0)
      }));

      const firstPrice = chartData[0].close;
      const lastPrice = chartData[chartData.length - 1].close;
      const change = lastPrice - firstPrice;
      const changePercent = ((change / firstPrice) * 100).toFixed(2);
      const lastDataTimestamp = chartData[chartData.length - 1].timestamp;

      let chartImageUrl = null;
      if (chartType !== 'candlestick') {
        const chartConfig = {
          type: chartType === 'bar' ? 'bar' : 'line',
          data: {
            labels: chartData.map(d => new Date(d.timestamp).toLocaleDateString()),
            datasets: [{
              label: `${symbol.toUpperCase()} Price`,
              data: chartData.map(d => d.close),
              borderColor: change >= 0 ? '#10b981' : '#ef4444',
              backgroundColor: change >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              fill: true,
              tension: 0.4
            }]
          },
          options: {
            plugins: { title: { display: true, text: `${stockName} (${symbol.toUpperCase()})` }, legend: { display: false } },
            scales: { y: { beginAtZero: false } }
          }
        };
        chartImageUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
      }

      return res.json({
        success: true,
        provider: 'mystocks',
        symbol: symbol.toUpperCase(),
        name: stockName,
        logo: stockLogo,
        timeframe,
        chartType,
        data: chartData,
        chartImageUrl,
        marketStatus: {
          isOpen: false,
          message: `African exchange data from MyStocks`,
          isLiveData: false,
          lastDataTimestamp
        },
        stats: {
          firstPrice,
          lastPrice,
          change,
          changePercent: parseFloat(changePercent),
          trend: change >= 0 ? 'up' : 'down',
          high: Math.max(...chartData.map(d => d.high)),
          low: Math.min(...chartData.map(d => d.low)),
          totalVolume: chartData.reduce((sum, d) => sum + d.volume, 0),
          dataAge: `Last updated: ${new Date(lastDataTimestamp).toLocaleString()}`
        },
        count: chartData.length
      });
    }

    // Get bars data (Alpaca — US stocks)
    logger.info(`Fetching bars for ${symbol}: timeframe=${timeframe}, limit=${limit}`);

    const bars = await alpacaService.getBars(
      symbol.toUpperCase(),
      timeframe,
      null,
      null,
      limitNum
    );

    logger.info(`Received ${bars?.length || 0} bars for ${symbol}`);

    if (!bars || bars.length === 0) {
      logger.warn(`No bars data returned for ${symbol} with timeframe ${timeframe}`);
      return res.status(404).json({
        success: false,
        message: 'No chart data available for this symbol. The market may be closed or this symbol may not have recent trading data.'
      });
    }

    // Get asset info
    let assetName = symbol;
    try {
      const asset = await alpacaService.getAsset(symbol.toUpperCase());
      assetName = asset.name;
    } catch (error) {
      logger.debug(`Could not fetch asset name for ${symbol}`);
    }

    // Format data for response
    const chartData = bars.map(bar => ({
      timestamp: bar.t,
      open: parseFloat(bar.o),
      high: parseFloat(bar.h),
      low: parseFloat(bar.l),
      close: parseFloat(bar.c),
      volume: parseInt(bar.v)
    }));

    // Generate QuickChart URL for chart image
    const labels = chartData.map(d => new Date(d.timestamp).toLocaleDateString());
    const prices = chartData.map(d => d.close);

    let chartConfig;
    if (chartType === 'candlestick') {
      // For candlestick, return data for frontend to render
      chartConfig = null;
    } else {
      // Generate line/bar chart URL
      chartConfig = {
        type: chartType === 'bar' ? 'bar' : 'line',
        data: {
          labels: labels,
          datasets: [{
            label: `${symbol.toUpperCase()} Price`,
            data: prices,
            borderColor: prices[prices.length - 1] >= prices[0] ? '#10b981' : '#ef4444',
            backgroundColor: prices[prices.length - 1] >= prices[0] ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          plugins: {
            title: {
              display: true,
              text: `${assetName} (${symbol.toUpperCase()})`
            },
            legend: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: false
            }
          }
        }
      };
    }

    // Calculate trend
    const firstPrice = chartData[0].close;
    const lastPrice = chartData[chartData.length - 1].close;
    const change = lastPrice - firstPrice;
    const changePercent = ((change / firstPrice) * 100).toFixed(2);

    // Get market status to indicate if showing historical data
    let marketStatus;
    let lastDataTimestamp = chartData[chartData.length - 1].timestamp;
    let isLiveData = false;

    try {
      marketStatus = await alpacaService.getMarketStatus();
      const lastDataDate = new Date(lastDataTimestamp);
      const now = new Date();
      const daysSinceLastData = Math.floor((now - lastDataDate) / (1000 * 60 * 60 * 24));
      const hoursSinceLastData = Math.floor((now - lastDataDate) / (1000 * 60 * 60));
      const minutesSinceLastData = Math.floor((now - lastDataDate) / (1000 * 60));

      // Determine if data is recent enough to be considered "live"
      // Data more than 1 day old is definitely historical
      if (daysSinceLastData > 30) {
        // Data is extremely old (more than 30 days) - free tier limitation
        const monthsOld = Math.floor(daysSinceLastData / 30);
        marketStatus.message = `⚠️ Historical data from ${lastDataDate.toLocaleDateString()} (${monthsOld} months ago). Free tier IEX feed has limited access to recent data. Upgrade to a paid Alpaca subscription for real-time data.`;
        isLiveData = false;
      } else if (daysSinceLastData > 1) {
        // Data is old (more than 1 day)
        marketStatus.message = `Historical data from ${lastDataDate.toLocaleDateString()} (${daysSinceLastData} days ago) - Most recent available on free tier`;
        isLiveData = false;
      } else if (hoursSinceLastData >= 1) {
        // Data is several hours old
        marketStatus.message = `Delayed data from ${lastDataDate.toLocaleTimeString()} (${hoursSinceLastData} hours ago)`;
        isLiveData = false;
      } else if (minutesSinceLastData >= 15) {
        // Data is 15+ minutes old (typical free tier delay)
        if (marketStatus.is_open) {
          marketStatus.message = `Market open. Delayed ${minutesSinceLastData} min - Free tier limitation`;
        } else {
          marketStatus.message = `Market closed. Showing last session from ${lastDataDate.toLocaleString()}`;
        }
        isLiveData = false;
      } else {
        // Data is recent (under 15 minutes old)
        if (marketStatus.is_open) {
          marketStatus.message = 'Market open. Showing near real-time data';
          isLiveData = true;
        } else {
          marketStatus.message = `Market closed. Last session data from ${lastDataDate.toLocaleString()}`;
          isLiveData = false;
        }
      }
    } catch (error) {
      logger.warn('Could not fetch market status:', error.message);
      const lastDataDate = new Date(lastDataTimestamp);
      const now = new Date();
      const daysSinceLastData = Math.floor((now - lastDataDate) / (1000 * 60 * 60 * 24));

      marketStatus = {
        is_open: false,
        message: daysSinceLastData > 1
          ? `Historical data from ${lastDataDate.toLocaleDateString()} (${daysSinceLastData} days ago)`
          : `Showing data from ${lastDataDate.toLocaleDateString()}`
      };
    }

    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      name: assetName,
      logo: alpacaService.getCompanyLogo(symbol.toUpperCase(), assetName),
      timeframe,
      chartType,
      data: chartData,
      chartImageUrl: chartConfig ? `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}` : null,
      marketStatus: {
        isOpen: marketStatus.is_open,
        message: marketStatus.message,
        nextOpen: marketStatus.next_open,
        nextClose: marketStatus.next_close,
        isLiveData: isLiveData,
        lastDataTimestamp: lastDataTimestamp
      },
      stats: {
        firstPrice,
        lastPrice,
        change,
        changePercent: parseFloat(changePercent),
        trend: change >= 0 ? 'up' : 'down',
        high: Math.max(...chartData.map(d => d.high)),
        low: Math.min(...chartData.map(d => d.low)),
        totalVolume: chartData.reduce((sum, d) => sum + d.volume, 0),
        dataAge: isLiveData ? 'live' : `Last updated: ${new Date(lastDataTimestamp).toLocaleString()}`
      },
      count: chartData.length
    });
  } catch (error) {
    logger.error('Get stock chart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chart data. Please try again in a moment.'
    });
  }
};

// Helper function to fetch financial data from Yahoo Finance (fallback)
const getYahooFinanceData = async (symbol) => {
  try {
    // Try Yahoo Finance v8 API (more reliable)
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?modules=assetProfile,summaryDetail,defaultKeyStatistics,financialData`;

    logger.info(`Fetching financial data for ${symbol} from Yahoo Finance`);
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    // v8 chart API returns different structure
    const meta = response.data?.chart?.result?.[0]?.meta;
    if (meta) {
      return {
        marketCap: null, // Not in chart API
        peRatio: null,
        dividendYield: null,
        eps: null,
        beta: null,
        sector: null,
        industry: null,
        website: null,
        description: null,
        ceo: null,
        employees: null,
        country: null,
        city: null,
        revenue: null,
        profitMargin: null,
        '52WeekHigh': meta.fiftyTwoWeekHigh || null,
        '52WeekLow': meta.fiftyTwoWeekLow || null,
        regularMarketPrice: meta.regularMarketPrice || null,
        source: 'yahoo_chart'
      };
    }

    return null;
  } catch (error) {
    logger.warn(`Yahoo Finance v8 failed for ${symbol}:`, error.message);

    // Try alternative: Financial Modeling Prep (free tier)
    try {
      return await getFMPData(symbol);
    } catch (fmpError) {
      logger.warn(`FMP fallback also failed for ${symbol}:`, fmpError.message);
      return null;
    }
  }
};

// Helper function to fetch from Financial Modeling Prep (free API)
const getFMPData = async (symbol) => {
  try {
    const apiKey = process.env.FMP_API_KEY || 'demo';
    const url = `https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${apiKey}`;

    logger.info(`Fetching financial data for ${symbol} from FMP`);
    const response = await axios.get(url, { timeout: 5000 });

    const data = response.data?.[0];
    if (!data) {
      return null;
    }

    return {
      marketCap: data.mktCap ? `$${(data.mktCap / 1e9).toFixed(2)}B` : null,
      peRatio: data.pe || null,
      dividendYield: data.lastDiv ? `${data.lastDiv.toFixed(2)}%` : null,
      eps: null,
      beta: data.beta || null,
      sector: data.sector || null,
      industry: data.industry || null,
      website: data.website || null,
      description: data.description || null,
      ceo: data.ceo || null,
      employees: data.fullTimeEmployees || null,
      country: data.country || null,
      city: data.city || null,
      revenue: null,
      profitMargin: null,
      '52WeekHigh': data.range ? parseFloat(data.range.split('-')[1]) : null,
      '52WeekLow': data.range ? parseFloat(data.range.split('-')[0]) : null,
      bookValue: null,
      source: 'fmp'
    };
  } catch (error) {
    logger.warn(`FMP API failed for ${symbol}:`, error.message);
    return null;
  }
};

// Helper function to fetch financial data from free API (Alpha Vantage with Yahoo fallback)
const getFinancialData = async (symbol) => {
  try {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY || 'demo';
    const overviewUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${apiKey}`;

    logger.info(`Fetching financial data for ${symbol} from Alpha Vantage`);
    const response = await axios.get(overviewUrl, { timeout: 5000 });

    if (response.data && response.data.Symbol) {
      const data = response.data;

      return {
        marketCap: data.MarketCapitalization ? `$${(parseFloat(data.MarketCapitalization) / 1e9).toFixed(2)}B` : null,
        peRatio: data.PERatio ? parseFloat(data.PERatio) : null,
        dividendYield: data.DividendYield ? `${(parseFloat(data.DividendYield) * 100).toFixed(2)}%` : null,
        eps: data.EPS ? parseFloat(data.EPS) : null,
        beta: data.Beta ? parseFloat(data.Beta) : null,
        sector: data.Sector || null,
        industry: data.Industry || null,
        website: null,
        description: data.Description || null,
        ceo: null,
        employees: null,
        country: data.Country || null,
        city: null,
        revenue: data.RevenueTTM ? `$${(parseFloat(data.RevenueTTM) / 1e9).toFixed(2)}B` : null,
        profitMargin: data.ProfitMargin ? `${(parseFloat(data.ProfitMargin) * 100).toFixed(2)}%` : null,
        '52WeekHigh': data['52WeekHigh'] || null,
        '52WeekLow': data['52WeekLow'] || null,
        bookValue: data.BookValue || null,
        source: 'alphavantage'
      };
    }

    // Alpha Vantage returned no data, try Yahoo Finance as fallback
    logger.info(`Alpha Vantage has no data for ${symbol}, trying Yahoo Finance fallback`);
    const yahooData = await getYahooFinanceData(symbol);
    if (yahooData) {
      return yahooData;
    }

    logger.warn(`No financial data found for ${symbol} from any source`);
    return {
      marketCap: null,
      peRatio: null,
      dividendYield: null,
      eps: null,
      beta: null,
      note: 'Financial data unavailable for this stock.'
    };
  } catch (error) {
    logger.error(`Failed to fetch financial data for ${symbol}:`, {
      message: error.message,
      status: error.response?.status
    });

    // Try Yahoo Finance as fallback on Alpha Vantage error
    logger.info(`Alpha Vantage error for ${symbol}, trying Yahoo Finance fallback`);
    const yahooData = await getYahooFinanceData(symbol);
    if (yahooData) {
      return yahooData;
    }

    return {
      marketCap: null,
      peRatio: null,
      dividendYield: null,
      eps: null,
      beta: null,
      note: 'Financial data service temporarily unavailable'
    };
  }
};

const getCompanyInfo = async (req, res) => {
  try {
    const { symbol } = req.params;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: 'Symbol is required'
      });
    }

    const upperSymbol = symbol.toUpperCase();

    // African stocks — served entirely from MyStocks
    if (isAfricanSymbol(upperSymbol)) {
      const ticker = upperSymbol.includes('.') ? upperSymbol.split('.')[0] : upperSymbol;
      const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

      // Fetch stock snapshot + slug detail + pulse in parallel
      let stockSnapshot = null;
      let slugData = null;
      let pulseData = null;
      try {
        const snap = await ms.getStocks({ search: ticker });
        const stocks = Array.isArray(snap) ? snap : (Array.isArray(snap?.stocks) ? snap.stocks : []);
        stockSnapshot = stocks.find(s => s.symbol?.toUpperCase() === upperSymbol) || stocks[0] || null;

        if (stockSnapshot?.name && stockSnapshot?.exchange) {
          const [slugResult, pulseResult] = await Promise.allSettled([
            ms.getStockBySlug(ms.buildStockSlug(stockSnapshot.name, stockSnapshot.exchange)),
            ms.getStockPulse(upperSymbol)
          ]);
          if (slugResult.status === 'fulfilled') slugData = slugResult.value;
          if (pulseResult.status === 'fulfilled') pulseData = pulseResult.value;
        }
      } catch (_) {}

      if (!stockSnapshot) {
        return res.status(404).json({ success: false, message: 'Symbol not found' });
      }

      const currentPrice = parseFloat(stockSnapshot.price || 0);
      const previousClose = parseFloat(stockSnapshot.previousClose || stockSnapshot.prevClose || 0);
      const priceChange = previousClose > 0 ? currentPrice - previousClose : null;
      const priceChangePercent = previousClose > 0 ? parseFloat(((priceChange / previousClose) * 100).toFixed(2)) : null;
      const logo = slugData?.logo?.imageUrl || `/api/v1/assets/logo/${upperSymbol}`;

      // Build position from MsOrder + DemoOrder
      let yourPosition = null;
      let isWatchlisted = false;
      const userId = req.user?.id;
      if (userId) {
        try {
          const [[realOrders, paperOrders], usdToLocal, watchlist] = await Promise.all([
            Promise.all([
              MsOrder.findAll({ where: { user_id: userId, symbol: upperSymbol } }),
              DemoOrder.findAll({ where: { user_id: userId, symbol: upperSymbol } })
            ]),
            exchangeService.getExchangeRate('USD', stockSnapshot.currency || 'KES').catch(() => exchangeRate),
            Watchlist.findOne({ where: { user_id: userId } }).catch(() => null)
          ]);
          isWatchlisted = watchlist?.symbols?.includes(upperSymbol) ?? false;

          const calcPosition = (orders, priceField) => {
            let qty = 0, cost = 0;
            for (const o of orders) {
              const q = parseFloat(o.quantity);
              const p = o[priceField] ? parseFloat(o[priceField]) * (priceField === 'price_usd' ? usdToLocal : 1) : 0;
              if (o.side === 'BUY') { qty += q; cost += q * p; }
              else { qty -= q; cost -= q * p; }
            }
            if (qty <= 0.00001) return null;
            const avgCost = cost / qty;
            const marketValue = qty * currentPrice;
            const totalReturn = marketValue - (qty * avgCost);
            return {
              shares: parseFloat(qty.toFixed(6)),
              marketValue: parseFloat(marketValue.toFixed(4)),
              avgCost: parseFloat(avgCost.toFixed(4)),
              portfolioDiversity: null,
              todayReturn: { amount: 0, percent: 0 },
              totalReturn: {
                amount: parseFloat(totalReturn.toFixed(4)),
                percent: avgCost > 0 ? parseFloat((((currentPrice - avgCost) / avgCost) * 100).toFixed(2)) : 0
              },
              side: 'long',
              currentPrice,
              lastDayPrice: previousClose || null
            };
          };

          const realPos = calcPosition(realOrders, 'local_price');
          const paperPos = calcPosition(paperOrders, 'price_usd');

          if (realPos || paperPos) {
            yourPosition = {
              ...(realPos || paperPos),
              source: realPos ? 'mystocks' : 'demo',
              realPosition: realPos,
              paperPosition: paperPos
            };
          }
        } catch (_) {}
      }

      return res.json({
        success: true,
        company: {
          symbol: upperSymbol,
          name: stockSnapshot.name || upperSymbol,
          exchange: stockSnapshot.exchange || upperSymbol.split('.')[1] || 'NSE',
          assetClass: 'african_equity',
          status: 'active',
          tradable: true,
          currency: stockSnapshot.currency || 'KES',
          currentPrice,
          currentPriceUSD: stockSnapshot.usdPrice ? parseFloat(stockSnapshot.usdPrice) : parseFloat((currentPrice / exchangeRate).toFixed(6)),
          priceChange,
          priceChangePercent,
          about: {
            description: slugData?.description || stockSnapshot.description || `${stockSnapshot.name} is listed on the ${stockSnapshot.exchange || 'NSE'}.`,
            sector: stockSnapshot.sector || slugData?.sector || null,
            industry: stockSnapshot.industry || slugData?.industry || null,
            website: stockSnapshot.website || slugData?.website || null,
            headquarters: stockSnapshot.country || null,
            ceo: null,
            employees: null
          },
          financials: (() => {
            // Merge fields from all three sources: stockSnapshot, slugData, pulseData
            const src = [stockSnapshot, slugData, pulseData].filter(Boolean);
            const pick = (...keys) => {
              for (const s of src) {
                for (const k of keys) {
                  const v = s?.[k];
                  if (v !== undefined && v !== null && v !== '') return v;
                }
              }
              return null;
            };
            return {
              marketCap: pick('marketCap', 'market_cap', 'marketCapitalization', 'market_capitalization'),
              peRatio: pick('peRatio', 'pe_ratio', 'pe', 'priceToEarnings', 'price_to_earnings'),
              dividendYield: pick('dividendYield', 'dividend_yield', 'dividendYieldTtm'),
              eps: pick('eps', 'earningsPerShare', 'earnings_per_share'),
              beta: pick('beta'),
              revenue: pick('revenue', 'totalRevenue', 'total_revenue'),
              profitMargin: pick('profitMargin', 'profit_margin', 'netProfitMargin'),
              high52Week: pick('high52Week', 'fiftyTwoWeekHigh', 'week52High', 'yearHigh', 'high_52_week'),
              low52Week: pick('low52Week', 'fiftyTwoWeekLow', 'week52Low', 'yearLow', 'low_52_week'),
              volume: pick('volume', 'avgVolume', 'averageVolume'),
              note: 'Financial data sourced from MyStocks Africa'
            };
          })(),
          tradingInfo: {
            marginable: false,
            shortable: false,
            easyToBorrow: false,
            fractionable: false,
            maintenanceMarginRequirement: null
          },
          recentNews: [],
          yourPosition,
          isWatchlisted,
          logo,
          provider: 'mystocks',
          lastUpdated: new Date().toISOString()
        }
      });
    }

    // Get asset details from Alpaca
    const asset = await alpacaService.getAsset(upperSymbol);

    // Get user's position for this symbol (if authenticated)
    let userPosition = null;
    const userId = req.user?.id;

    try {
      // Get user to check for Alpaca account
      const user = userId ? await User.findByPk(userId) : null;
      const alpacaAccountId = user?.alpaca_account_id;

      // Get all positions and account info from Alpaca (user-specific if account exists)
      const [positions, account] = await Promise.all([
        alpacaAccountId ? alpacaService.getPositions(alpacaAccountId) : Promise.resolve([]),
        alpacaAccountId ? alpacaService.getAccount(alpacaAccountId) : Promise.resolve({ equity: 0 })
      ]);

      // Find position for this specific symbol in Alpaca
      const position = positions.find(p => p.symbol === upperSymbol);

      if (position) {
        const shares = parseFloat(position.qty);
        const marketValue = parseFloat(position.market_value);
        const costBasis = parseFloat(position.cost_basis);
        const avgCost = costBasis / shares;
        const totalEquity = parseFloat(account.equity);
        const portfolioDiversity = totalEquity > 0 ? (marketValue / totalEquity) * 100 : 0;
        const todayReturn = parseFloat(position.unrealized_intraday_pl) || 0;
        const todayReturnPercent = parseFloat(position.unrealized_intraday_plpc) * 100 || 0;
        const totalReturn = parseFloat(position.unrealized_pl) || 0;
        const totalReturnPercent = parseFloat(position.unrealized_plpc) * 100 || 0;

        userPosition = {
          shares: shares,
          marketValue: parseFloat(marketValue.toFixed(2)),
          avgCost: parseFloat(avgCost.toFixed(2)),
          portfolioDiversity: `${portfolioDiversity.toFixed(2)}%`,
          todayReturn: {
            amount: parseFloat(todayReturn.toFixed(2)),
            percent: parseFloat(todayReturnPercent.toFixed(2))
          },
          totalReturn: {
            amount: parseFloat(totalReturn.toFixed(2)),
            percent: parseFloat(totalReturnPercent.toFixed(2))
          },
          side: position.side, // 'long' or 'short'
          currentPrice: parseFloat(position.current_price),
          lastDayPrice: parseFloat(position.lastday_price),
          source: 'alpaca'
        };
      } else if (userId) {
        // No position in Alpaca, check local Order database
        logger.info(`No Alpaca position for ${upperSymbol}, checking local orders for user ${userId}`);

        // Get filled orders for this symbol and user
        const filledOrders = await Order.findAll({
          where: {
            user_id: userId,
            symbol: upperSymbol,
            status: 'filled'
          },
          order: [['filled_at', 'ASC']]
        });

        if (filledOrders.length > 0) {
          // Calculate position from orders (sum buys - sum sells)
          let totalShares = 0;
          let totalCostBasis = 0;

          for (const order of filledOrders) {
            const qty = parseFloat(order.filled_quantity) || parseFloat(order.quantity);
            const price = parseFloat(order.average_price) || parseFloat(order.limit_price) || 0;

            if (order.side === 'buy') {
              totalShares += qty;
              totalCostBasis += qty * price;
            } else if (order.side === 'sell') {
              // When selling, reduce position proportionally
              if (totalShares > 0) {
                const avgCostPerShare = totalCostBasis / totalShares;
                totalCostBasis -= qty * avgCostPerShare;
              }
              totalShares -= qty;
            }
          }

          // Only show position if user still holds shares
          if (totalShares > 0) {
            const avgCost = totalCostBasis / totalShares;
            const totalEquity = parseFloat(account.equity) || 0;

            // Get current price for calculations
            let currentStockPrice = null;
            try {
              const quote = await alpacaService.getLatestQuote(upperSymbol);
              currentStockPrice = quote.ap || quote.bp;
            } catch (e) {
              logger.warn(`Could not get current price for ${upperSymbol}`);
            }

            const marketValue = currentStockPrice ? totalShares * currentStockPrice : totalCostBasis;
            const portfolioDiversity = totalEquity > 0 ? (marketValue / totalEquity) * 100 : 0;
            const totalReturn = currentStockPrice ? marketValue - totalCostBasis : 0;
            const totalReturnPercent = totalCostBasis > 0 ? (totalReturn / totalCostBasis) * 100 : 0;

            userPosition = {
              shares: parseFloat(totalShares.toFixed(6)),
              marketValue: parseFloat(marketValue.toFixed(2)),
              avgCost: parseFloat(avgCost.toFixed(2)),
              portfolioDiversity: `${portfolioDiversity.toFixed(2)}%`,
              todayReturn: {
                amount: 0, // Can't calculate from local orders
                percent: 0
              },
              totalReturn: {
                amount: parseFloat(totalReturn.toFixed(2)),
                percent: parseFloat(totalReturnPercent.toFixed(2))
              },
              side: 'long',
              currentPrice: currentStockPrice,
              lastDayPrice: null,
              source: 'local_orders'
            };
          }
        }
      }
    } catch (positionError) {
      logger.warn(`Failed to get user position for ${upperSymbol}:`, positionError.message);
      // Continue without position data - user may not have a position
    }

    let isWatchlisted = false;
    if (userId) {
      try {
        const watchlist = await Watchlist.findOne({ where: { user_id: userId } });
        isWatchlisted = watchlist?.symbols?.includes(upperSymbol) ?? false;
      } catch (_) {}
    }

    // Get latest quote for current price
    let currentPrice = null;
    let priceChange = null;
    let priceChangePercent = null;

    try {
      const quote = await alpacaService.getLatestQuote(upperSymbol);
      currentPrice = quote.ap || quote.bp;

      // Get yesterday's closing price
      const bars = await alpacaService.getBars(upperSymbol, '1Day', null, null, 2);
      if (bars && bars.length >= 2) {
        const previousClose = parseFloat(bars[bars.length - 2].c);
        priceChange = currentPrice - previousClose;
        priceChangePercent = (priceChange / previousClose) * 100;
      }
    } catch (error) {
      logger.warn(`Failed to get price data for ${upperSymbol}:`, error);
    }

    // Get recent news
    let recentNews = [];
    try {
      const news = await alpacaService.getNews([upperSymbol], 5);
      recentNews = news.map(article => ({
        id: article.id,
        headline: article.headline,
        summary: article.summary,
        publishedAt: article.published_at,
        url: article.url,
        source: article.source,
        thumbnail: article.images?.[0]?.url
      }));
    } catch (error) {
      logger.warn(`Failed to get news for ${upperSymbol}:`, error);
    }

    // Get financial data (includes company info like sector, industry, etc.)
    const financialData = await getFinancialData(upperSymbol);

    // Build company information response
    const companyInfo = {
      symbol: asset.symbol,
      name: asset.name,
      exchange: asset.exchange,
      assetClass: asset.class,
      status: asset.status,
      tradable: asset.tradable,

      // Current pricing
      currentPrice,
      priceChange,
      priceChangePercent: priceChangePercent ? parseFloat(priceChangePercent.toFixed(2)) : null,

      // Trading info
      tradingInfo: {
        marginable: asset.marginable,
        shortable: asset.shortable,
        easyToBorrow: asset.easy_to_borrow,
        fractionable: asset.fractionable,
        maintenanceMarginRequirement: asset.maintenance_margin_requirement
      },

      // About (using data from financial API)
      about: {
        description: financialData.description || `${asset.name} (${asset.symbol}) is a ${asset.class} security trading on ${asset.exchange}.`,
        sector: financialData.sector || null,
        industry: financialData.industry || null,
        website: financialData.website || null,
        headquarters: financialData.city && financialData.country ? `${financialData.city}, ${financialData.country}` : null,
        ceo: financialData.ceo || null,
        employees: financialData.employees || null
      },

      // Financial highlights
      financials: {
        marketCap: financialData.marketCap,
        peRatio: financialData.peRatio,
        dividendYield: financialData.dividendYield,
        eps: financialData.eps,
        beta: financialData.beta,
        revenue: financialData.revenue,
        profitMargin: financialData.profitMargin,
        note: financialData.note
      },

      // Recent news
      recentNews,

      // User's position (null if user has no position in this stock)
      yourPosition: userPosition,

      isWatchlisted,
      logo: alpacaService.getCompanyLogo(upperSymbol),
      lastUpdated: new Date().toISOString()
    };

    res.json({
      success: true,
      company: companyInfo
    });

  } catch (error) {
    logger.error('Get company info error:', error);

    if (error.message.includes('symbol not found') || error.message.includes('asset not found')) {
      return res.status(404).json({
        success: false,
        message: 'Symbol not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch company information'
    });
  }
};

module.exports = {
  getQuote,
  getLatestTrade,
  getBars,
  getMultipleQuotes,
  getMarketStatus,
  getNews,
  getNewsById,
  getMarketCalendar,
  getStockFundamentals,
  // Watchlist management
  getAllWatchlists,
  manageWatchlist, // New unified endpoint
  createWatchlist, // Legacy (backward compatibility)
  getWatchlist,
  updateWatchlist,
  addSymbolToWatchlist,
  removeSymbolFromWatchlist,
  deleteWatchlist,
  // Market movers & events
  getTopMovers,
  getUpcomingEvents,
  // Charts
  getStockChart,
  // Company info & financials
  getCompanyInfo
};