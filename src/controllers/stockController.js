const alpacaService = require('../services/alpacaService');
const logger = require('../utils/logger');
const { mapConditionCodes } = require('../utils/conditionCodes');

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

    res.json({
      success: true,
      quote: {
        symbol: symbol.toUpperCase(),
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

    res.json({
      success: true,
      trade: {
        symbol: symbol.toUpperCase(),
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
 */
const getAllWatchlists = async (req, res) => {
  try {
    const watchlists = await alpacaService.getAllWatchlists();

    // Log the raw response to debug
    logger.info('Raw watchlists from Alpaca:', JSON.stringify(watchlists, null, 2));

    // Alpaca's GET /v2/watchlists sometimes returns empty assets array
    // We need to fetch each watchlist individually to get full details
    const detailedWatchlists = await Promise.all(
      watchlists.map(async (w) => {
        try {
          // Fetch full watchlist details
          const fullWatchlist = await alpacaService.getWatchlistById(w.id);

          return {
            id: fullWatchlist.id,
            name: fullWatchlist.name,
            symbolCount: fullWatchlist.assets ? fullWatchlist.assets.length : 0,
            symbols: fullWatchlist.assets ? fullWatchlist.assets.map(a => a.symbol) : [],
            createdAt: fullWatchlist.created_at,
            updatedAt: fullWatchlist.updated_at
          };
        } catch (error) {
          logger.warn(`Failed to fetch details for watchlist ${w.id}:`, error.message);
          // Fallback to basic info
          return {
            id: w.id,
            name: w.name,
            symbolCount: w.assets ? w.assets.length : 0,
            symbols: w.assets ? w.assets.map(a => a.symbol || a) : [],
            createdAt: w.created_at,
            updatedAt: w.updated_at
          };
        }
      })
    );

    res.json({
      success: true,
      watchlists: detailedWatchlists,
      count: detailedWatchlists.length
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

    const watchlist = await alpacaService.createWatchlist(name.trim(), symbols);

    res.status(201).json({
      success: true,
      message: `Watchlist "${name}" created successfully.`,
      watchlist: {
        id: watchlist.id,
        name: watchlist.name,
        symbols: watchlist.assets.map(a => a.symbol),
        createdAt: watchlist.created_at,
        updatedAt: watchlist.updated_at
      }
    });
  } catch (error) {
    logger.error('Create watchlist error:', error);

    if (error.message.includes('already exists')) {
      return res.status(400).json({
        success: false,
        message: 'A watchlist with this name already exists. Please choose a different name.'
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
 * GET /api/v1/stocks/watchlist/:watchlistId
 */
const getWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;

    if (!watchlistId) {
      return res.status(400).json({
        success: false,
        message: 'Watchlist ID is required.'
      });
    }

    const watchlist = await alpacaService.getWatchlistWithMarketData(watchlistId);

    res.json({
      success: true,
      watchlist: {
        id: watchlist.id,
        name: watchlist.name,
        assets: watchlist.assets,
        count: watchlist.count,
        createdAt: watchlist.created_at,
        updatedAt: watchlist.updated_at
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
 * PUT /api/v1/stocks/watchlist/:watchlistId
 */
const updateWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;
    const { name, symbols } = req.body;

    if (!watchlistId) {
      return res.status(400).json({
        success: false,
        message: 'Watchlist ID is required.'
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

    const watchlist = await alpacaService.updateWatchlist(watchlistId, name.trim(), symbols);

    res.json({
      success: true,
      message: 'Watchlist updated successfully.',
      watchlist: {
        id: watchlist.id,
        name: watchlist.name,
        symbols: watchlist.assets.map(a => a.symbol),
        updatedAt: watchlist.updated_at
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
 * POST /api/v1/stocks/watchlist/:watchlistId/symbols
 */
const addSymbolToWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;
    const { symbol } = req.body;

    if (!watchlistId) {
      return res.status(400).json({
        success: false,
        message: 'Watchlist ID is required.'
      });
    }

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid stock symbol.'
      });
    }

    const watchlist = await alpacaService.addSymbolToWatchlist(watchlistId, symbol);

    res.json({
      success: true,
      message: `${symbol.toUpperCase()} added to your watchlist successfully.`,
      watchlist: {
        id: watchlist.id,
        name: watchlist.name,
        symbols: watchlist.assets.map(a => a.symbol),
        updatedAt: watchlist.updated_at
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
 * DELETE /api/v1/stocks/watchlist/:watchlistId/symbols/:symbol
 */
const removeSymbolFromWatchlist = async (req, res) => {
  try {
    const { watchlistId, symbol } = req.params;

    if (!watchlistId || !symbol) {
      return res.status(400).json({
        success: false,
        message: 'Both watchlist ID and symbol are required.'
      });
    }

    const watchlist = await alpacaService.removeSymbolFromWatchlist(watchlistId, symbol);

    res.json({
      success: true,
      message: `${symbol.toUpperCase()} removed from your watchlist successfully.`,
      watchlist: {
        id: watchlist.id,
        name: watchlist.name,
        symbols: watchlist.assets.map(a => a.symbol),
        updatedAt: watchlist.updated_at
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
 * DELETE /api/v1/stocks/watchlist/:watchlistId
 */
const deleteWatchlist = async (req, res) => {
  try {
    const { watchlistId } = req.params;

    if (!watchlistId) {
      return res.status(400).json({
        success: false,
        message: 'Watchlist ID is required.'
      });
    }

    await alpacaService.deleteWatchlist(watchlistId);

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

module.exports = {
  getQuote,
  getLatestTrade,
  getBars,
  getMultipleQuotes,
  getMarketStatus,
  getNews,
  getMarketCalendar,
  getStockFundamentals,
  // Watchlist management
  getAllWatchlists,
  createWatchlist,
  getWatchlist,
  updateWatchlist,
  addSymbolToWatchlist,
  removeSymbolFromWatchlist,
  deleteWatchlist
};