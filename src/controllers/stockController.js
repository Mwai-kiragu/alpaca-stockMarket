const alpacaService = require('../services/alpacaService');
const logger = require('../utils/logger');

const getQuote = async (req, res) => {
  try {
    const { symbol } = req.params;

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
        conditions: quote.c || []
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
  try {
    const { symbol } = req.params;

    const trade = await alpacaService.getLatestTrade(symbol.toUpperCase());

    res.json({
      success: true,
      trade: {
        symbol: symbol.toUpperCase(),
        price: trade.p,
        size: trade.s,
        timestamp: trade.t,
        conditions: trade.c || [],
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
  try {
    const { symbol } = req.params;
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
            conditions: quote.c || []
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
        timestamp: marketStatus.timestamp || new Date().toISOString()
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
    const { symbols, limit = 10, start, end } = req.query;

    let symbolsArray;
    if (symbols) {
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
  try {
    const { symbol } = req.params;

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

const getWatchlist = async (req, res) => {
  try {
    // This would typically come from user's saved watchlist
    // For now, return popular stocks
    const popularSymbols = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX'];

    const quotes = {};

    await Promise.allSettled(
      popularSymbols.map(async (symbol) => {
        try {
          const quote = await alpacaService.getLatestQuote(symbol);
          const bars = await alpacaService.getBars(symbol, '1Day', null, null, 2);

          let changePercent = 0;
          if (bars.length >= 2) {
            const currentPrice = quote.ap || quote.bp;
            const previousClose = parseFloat(bars[bars.length - 2].c);
            changePercent = ((currentPrice - previousClose) / previousClose) * 100;
          }

          quotes[symbol] = {
            symbol,
            price: quote.ap || quote.bp,
            askPrice: quote.ap,
            bidPrice: quote.bp,
            changePercent: changePercent.toFixed(2),
            timestamp: quote.t
          };
        } catch (error) {
          logger.warn(`Failed to get quote for ${symbol}:`, error);
        }
      })
    );

    res.json({
      success: true,
      watchlist: Object.values(quotes),
      count: Object.keys(quotes).length
    });
  } catch (error) {
    logger.error('Get watchlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch watchlist'
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
  getWatchlist
};