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

      try {
        await alpacaService.addSymbolToWatchlist(
          existingWatchlist.alpaca_watchlist_id,
          addSymbol.toUpperCase()
        );
      } catch (alpacaError) {
        if (alpacaError.message.includes('not found') || alpacaError.message.includes('404')) {
          logger.warn(`Alpaca watchlist ${existingWatchlist.alpaca_watchlist_id} not found. Recreating...`);

          const newSymbols = [...existingWatchlist.symbols, addSymbol.toUpperCase()];
          const alpacaWatchlist = await alpacaService.createWatchlist(
            existingWatchlist.name,
            newSymbols
          );

          await existingWatchlist.update({
            alpaca_watchlist_id: alpacaWatchlist.id,
            symbols: newSymbols
          });

          return res.json({
            success: true,
            message: `${addSymbol} added to watchlist successfully.`,
            data: {
              id: existingWatchlist.id,
              name: existingWatchlist.name,
              symbols: newSymbols,
              createdAt: existingWatchlist.created_at,
              updatedAt: existingWatchlist.updated_at
            }
          });
        }
        throw alpacaError; // Re-throw other errors
      }

      const updatedSymbols = [...existingWatchlist.symbols, addSymbol.toUpperCase()];
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

      try {
        await alpacaService.removeSymbolFromWatchlist(
          existingWatchlist.alpaca_watchlist_id,
          symbolUpper
        );
      } catch (alpacaError) {
        if (alpacaError.message.includes('not found') || alpacaError.message.includes('404')) {
          logger.warn(`Alpaca watchlist ${existingWatchlist.alpaca_watchlist_id} not found. Recreating...`);

          const remainingSymbols = existingWatchlist.symbols.filter(s => s !== symbolUpper);

          if (remainingSymbols.length > 0) {
            const alpacaWatchlist = await alpacaService.createWatchlist(
              existingWatchlist.name,
              remainingSymbols
            );

            await existingWatchlist.update({
              alpaca_watchlist_id: alpacaWatchlist.id,
              symbols: remainingSymbols
            });
          } else {
            await existingWatchlist.update({ symbols: remainingSymbols });
          }

          return res.json({
            success: true,
            message: `${symbolUpper} removed from watchlist successfully.`,
            data: {
              id: existingWatchlist.id,
              name: existingWatchlist.name,
              symbols: remainingSymbols,
              createdAt: existingWatchlist.created_at,
              updatedAt: existingWatchlist.updated_at
            }
          });
        }
        throw alpacaError; // Re-throw other errors
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
      let alpacaWatchlist;

      try {
        // Try to update in Alpaca
        alpacaWatchlist = await alpacaService.updateWatchlist(
          existingWatchlist.alpaca_watchlist_id,
          name.trim(),
          symbols
        );
      } catch (alpacaError) {
        // If Alpaca watchlist not found (404), recreate it
        if (alpacaError.message.includes('not found') || alpacaError.message.includes('404')) {
          logger.warn(`Alpaca watchlist ${existingWatchlist.alpaca_watchlist_id} not found. Recreating...`);

          // Recreate watchlist in Alpaca with new symbols
          alpacaWatchlist = await alpacaService.createWatchlist(name.trim(), symbols);

          // Update database with new Alpaca ID
          await existingWatchlist.update({
            alpaca_watchlist_id: alpacaWatchlist.id,
            name: alpacaWatchlist.name,
            symbols: alpacaWatchlist.assets.map(a => a.symbol)
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

      // Update in database
      await existingWatchlist.update({
        name: alpacaWatchlist.name,
        symbols: alpacaWatchlist.assets.map(a => a.symbol)
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
    }

    const alpacaWatchlist = await alpacaService.createWatchlist(name.trim(), symbols);

    const dbWatchlist = await Watchlist.create({
      user_id: userId,
      alpaca_watchlist_id: alpacaWatchlist.id,
      name: alpacaWatchlist.name,
      symbols: alpacaWatchlist.assets.map(a => a.symbol)
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
    const limit = parseInt(req.query.limit) || 10;

    if (limit < 1 || limit > 20) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 20.'
      });
    }

    const movers = await alpacaService.getTopMovers(limit);

    // Get market status
    let marketStatus;
    try {
      marketStatus = await alpacaService.getMarketStatus();
      if (!marketStatus.is_open) {
        marketStatus.message = 'Market closed. Showing data from last trading session';
      } else {
        marketStatus.message = 'Market is open. Showing live data';
      }
    } catch (error) {
      marketStatus = {
        is_open: false,
        message: 'Market status unavailable'
      };
    }

    res.json({
      success: true,
      data: {
        gainers: movers.gainers,
        losers: movers.losers,
        lastUpdated: movers.lastUpdated
      },
      marketStatus: {
        isOpen: marketStatus.is_open,
        message: marketStatus.message,
        nextOpen: marketStatus.next_open,
        nextClose: marketStatus.next_close
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

    // Get bars data
    logger.info(`Fetching bars for ${symbol}: timeframe=${timeframe}, limit=${limit}`);

    const bars = await alpacaService.getBars(
      symbol.toUpperCase(),
      timeframe,
      null,
      null,
      Math.min(parseInt(limit), 100)
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
  getStockChart
};