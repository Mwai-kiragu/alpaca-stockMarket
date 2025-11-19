const alpacaService = require('../services/alpacaService');
const logger = require('../utils/logger');
const { mapConditionCodes } = require('../utils/conditionCodes');
const { Watchlist } = require('../models');

const getQuote = async (req, res) => {
  const { symbol } = req.params;

  try {
    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: 'Stock symbol is required'
      });
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
    const { timeframe = '1Day', start, end, limit = 100 } = req.query;

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

    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      name: assetName,
      logo: alpacaService.getCompanyLogo(symbol.toUpperCase(), assetName),
      timeframe,
      bars: formattedBars,
      count: formattedBars.length
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
    const { symbol, symbols, limit = 10, start, end } = req.query;

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

/**
 * Get a specific news article by ID
 * GET /api/v1/stocks/news/:newsId
 */
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

// ============================================================
// WATCHLIST MANAGEMENT - Using Alpaca Watchlist API
// ============================================================

/**
 * Get all watchlists for the user
 * GET /api/v1/stocks/watchlists
 * Note: Users are limited to one watchlist, so this returns an array with max 1 item
 */
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

/**
 * Create a new watchlist
 * POST /api/v1/stocks/watchlists
 */
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

/**
 * Get a specific watchlist with market data
 * GET /api/v1/stocks/watchlist/:watchlistId (optional)
 * If watchlistId is not provided, returns the user's single watchlist
 */
const getWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;
    const userId = req.user.id;

    let dbWatchlist;

    if (watchlistId) {
      // Fetch by provided ID and ensure it belongs to the user
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

    // Fetch market data from Alpaca using the alpaca_watchlist_id
    const watchlistWithMarketData = await alpacaService.getWatchlistWithMarketData(
      dbWatchlist.alpaca_watchlist_id
    );

    res.json({
      success: true,
      watchlist: {
        id: dbWatchlist.id,
        alpacaWatchlistId: dbWatchlist.alpaca_watchlist_id,
        name: watchlistWithMarketData.name,
        assets: watchlistWithMarketData.assets,
        count: watchlistWithMarketData.count,
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

/**
 * Update a watchlist (name and/or symbols)
 * PUT /api/v1/stocks/watchlist/:watchlistId (optional - uses user's single watchlist if not provided)
 */
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

    // Update in Alpaca
    const alpacaWatchlist = await alpacaService.updateWatchlist(
      dbWatchlist.alpaca_watchlist_id,
      name.trim(),
      symbols
    );

    // Update in database
    await dbWatchlist.update({
      name: alpacaWatchlist.name,
      symbols: alpacaWatchlist.assets.map(a => a.symbol)
    });

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

/**
 * Add a symbol to a watchlist
 * POST /api/v1/stocks/watchlist/:watchlistId/symbols (watchlistId optional)
 */
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

    // Add to Alpaca
    const alpacaWatchlist = await alpacaService.addSymbolToWatchlist(
      dbWatchlist.alpaca_watchlist_id,
      symbol
    );

    // Update database
    await dbWatchlist.update({
      symbols: alpacaWatchlist.assets.map(a => a.symbol)
    });

    res.json({
      success: true,
      message: `${symbol.toUpperCase()} added to your watchlist successfully.`,
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

    if (error.message.includes('already exists')) {
      return res.status(400).json({
        success: false,
        message: 'This symbol is already in your watchlist.'
      });
    }

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

/**
 * Remove a symbol from a watchlist
 * DELETE /api/v1/stocks/watchlist/:watchlistId/symbols/:symbol (watchlistId optional)
 */
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

/**
 * Delete a watchlist
 * DELETE /api/v1/stocks/watchlist/:watchlistId (optional - deletes user's single watchlist if not provided)
 */
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

// ============================================================
// MARKET MOVERS & EVENTS
// ============================================================

/**
 * Get top movers (gainers and losers)
 * GET /api/v1/stocks/movers
 */
const getTopMovers = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    if (limit < 1 || limit > 20) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 20.'
      });
    }

    const movers = await alpacaService.getTopMovers(limit);

    res.json({
      success: true,
      data: {
        gainers: movers.gainers,
        losers: movers.losers,
        lastUpdated: movers.lastUpdated
      },
      count: {
        gainers: movers.gainers.length,
        losers: movers.losers.length
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

/**
 * Get upcoming market events
 * GET /api/v1/stocks/events
 */
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
  createWatchlist,
  getWatchlist,
  updateWatchlist,
  addSymbolToWatchlist,
  removeSymbolFromWatchlist,
  deleteWatchlist,
  // Market movers & events
  getTopMovers,
  getUpcomingEvents
};