const alpacaService = require('../services/alpacaService');
const logger = require('../utils/logger');

const getMarketNews = async (req, res) => {
  try {
    const { symbols, category, limit = 20, page = 1 } = req.query;

    let symbolsArray;
    if (symbols) {
      symbolsArray = symbols.split(',').map(s => s.toUpperCase().trim()).slice(0, 10);
    }

    const newsLimit = Math.min(parseInt(limit), 50);
    const news = await alpacaService.getNews(symbolsArray, newsLimit);

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
      images: article.images || [],
      category: category || 'general'
    }));

    const startIndex = (page - 1) * newsLimit;
    const paginatedNews = formattedNews.slice(startIndex, startIndex + newsLimit);

    res.json({
      success: true,
      news: paginatedNews,
      count: paginatedNews.length,
      totalCount: formattedNews.length,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(formattedNews.length / newsLimit),
        hasMore: startIndex + newsLimit < formattedNews.length
      },
      filters: {
        symbols: symbolsArray || 'general',
        category: category || 'general',
        limit: newsLimit
      }
    });
  } catch (error) {
    logger.error('Get market news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch market news'
    });
  }
};

const getEducationalContent = async (req, res) => {
  try {
    const { category = 'trading', level = 'beginner', limit = 10 } = req.query;

    const educationalContent = {
      beginner: {
        trading: [
          {
            id: 'trading-basics-1',
            title: 'Introduction to Stock Trading',
            summary: 'Learn the fundamentals of stock trading and how markets work.',
            content: 'Stock trading involves buying and selling shares of publicly traded companies. When you buy a stock, you become a shareholder and own a small piece of that company...',
            category: 'trading',
            level: 'beginner',
            readTime: '5 minutes',
            tags: ['basics', 'stocks', 'introduction'],
            publishedAt: new Date().toISOString(),
            author: 'Trading Platform Education Team'
          },
          {
            id: 'trading-basics-2',
            title: 'Understanding Market Orders vs Limit Orders',
            summary: 'Learn the difference between market orders and limit orders and when to use each.',
            content: 'There are two main types of orders: Market Orders execute immediately at the current market price, while Limit Orders only execute at your specified price or better...',
            category: 'trading',
            level: 'beginner',
            readTime: '7 minutes',
            tags: ['orders', 'market', 'limit'],
            publishedAt: new Date().toISOString(),
            author: 'Trading Platform Education Team'
          },
          {
            id: 'trading-basics-3',
            title: 'Risk Management in Trading',
            summary: 'Essential risk management strategies every trader should know.',
            content: 'Risk management is crucial for successful trading. Never risk more than you can afford to lose, diversify your portfolio, and always have a plan...',
            category: 'trading',
            level: 'beginner',
            readTime: '8 minutes',
            tags: ['risk', 'management', 'strategy'],
            publishedAt: new Date().toISOString(),
            author: 'Trading Platform Education Team'
          }
        ],
        investing: [
          {
            id: 'investing-basics-1',
            title: 'Long-term vs Short-term Investing',
            summary: 'Understand the difference between investing and trading strategies.',
            content: 'Long-term investing focuses on buying and holding quality companies for years, while short-term trading seeks to profit from price movements...',
            category: 'investing',
            level: 'beginner',
            readTime: '6 minutes',
            tags: ['investing', 'long-term', 'strategy'],
            publishedAt: new Date().toISOString(),
            author: 'Trading Platform Education Team'
          }
        ]
      },
      intermediate: {
        trading: [
          {
            id: 'trading-intermediate-1',
            title: 'Technical Analysis Fundamentals',
            summary: 'Learn to read charts and identify trading patterns.',
            content: 'Technical analysis involves studying price charts and patterns to predict future price movements. Key concepts include support, resistance, and trend lines...',
            category: 'trading',
            level: 'intermediate',
            readTime: '12 minutes',
            tags: ['technical', 'analysis', 'charts'],
            publishedAt: new Date().toISOString(),
            author: 'Trading Platform Education Team'
          },
          {
            id: 'trading-intermediate-2',
            title: 'Position Sizing and Portfolio Management',
            summary: 'Advanced strategies for managing your trading portfolio.',
            content: 'Position sizing determines how much capital to allocate to each trade. The 2% rule suggests never risking more than 2% of your account on a single trade...',
            category: 'trading',
            level: 'intermediate',
            readTime: '10 minutes',
            tags: ['position', 'sizing', 'portfolio'],
            publishedAt: new Date().toISOString(),
            author: 'Trading Platform Education Team'
          }
        ]
      },
      advanced: {
        trading: [
          {
            id: 'trading-advanced-1',
            title: 'Options Trading Strategies',
            summary: 'Advanced options trading strategies for experienced traders.',
            content: 'Options provide flexibility and leverage in trading. Popular strategies include covered calls, protective puts, and iron condors...',
            category: 'trading',
            level: 'advanced',
            readTime: '15 minutes',
            tags: ['options', 'advanced', 'strategies'],
            publishedAt: new Date().toISOString(),
            author: 'Trading Platform Education Team'
          }
        ]
      }
    };

    const content = educationalContent[level]?.[category] || [];
    const limitedContent = content.slice(0, Math.min(parseInt(limit), 20));

    res.json({
      success: true,
      content: limitedContent,
      count: limitedContent.length,
      filters: {
        category,
        level,
        limit: parseInt(limit)
      },
      availableCategories: ['trading', 'investing', 'analysis', 'risk-management'],
      availableLevels: ['beginner', 'intermediate', 'advanced']
    });
  } catch (error) {
    logger.error('Get educational content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch educational content'
    });
  }
};

const getMarketInsights = async (req, res) => {
  try {
    const { type = 'daily', symbols } = req.query;

    let symbolsArray;
    if (symbols) {
      symbolsArray = symbols.split(',').map(s => s.toUpperCase().trim()).slice(0, 5);
    } else {
      symbolsArray = ['SPY', 'QQQ', 'DIA', 'IWM', 'VTI'];
    }

    const insights = [];

    for (const symbol of symbolsArray) {
      try {
        const [quote, bars] = await Promise.all([
          alpacaService.getLatestQuote(symbol),
          alpacaService.getBars(symbol, '1Day', null, null, 30)
        ]);

        if (bars.length >= 2) {
          const currentPrice = quote.ap || quote.bp;
          const previousClose = parseFloat(bars[bars.length - 2].c);
          const change = currentPrice - previousClose;
          const changePercent = (change / previousClose) * 100;

          let volatility = 0;
          if (bars.length >= 10) {
            const returns = [];
            for (let i = 1; i < Math.min(bars.length, 20); i++) {
              const dailyReturn = (parseFloat(bars[i].c) - parseFloat(bars[i - 1].c)) / parseFloat(bars[i - 1].c);
              returns.push(dailyReturn);
            }
            const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
            volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
          }

          let trend = 'neutral';
          if (bars.length >= 5) {
            const recentPrices = bars.slice(-5).map(bar => parseFloat(bar.c));
            const firstPrice = recentPrices[0];
            const lastPrice = recentPrices[recentPrices.length - 1];
            if (lastPrice > firstPrice * 1.02) trend = 'bullish';
            else if (lastPrice < firstPrice * 0.98) trend = 'bearish';
          }

          insights.push({
            symbol,
            currentPrice,
            change,
            changePercent: parseFloat(changePercent.toFixed(2)),
            volume: parseInt(bars[bars.length - 1]?.v || 0),
            avgVolume: Math.round(bars.slice(-10).reduce((sum, bar) => sum + parseInt(bar.v || 0), 0) / Math.min(bars.length, 10)),
            volatility: parseFloat(volatility.toFixed(2)),
            trend,
            support: Math.min(...bars.slice(-20).map(bar => parseFloat(bar.l))),
            resistance: Math.max(...bars.slice(-20).map(bar => parseFloat(bar.h))),
            lastUpdated: quote.t
          });
        }
      } catch (symbolError) {
        logger.warn(`Failed to get insights for ${symbol}:`, symbolError);
      }
    }

    const marketSummary = {
      timestamp: new Date().toISOString(),
      totalSymbols: insights.length,
      bullishCount: insights.filter(i => i.trend === 'bullish').length,
      bearishCount: insights.filter(i => i.trend === 'bearish').length,
      avgVolatility: insights.length > 0 ? (insights.reduce((sum, i) => sum + i.volatility, 0) / insights.length).toFixed(2) : 0,
      topGainers: insights.filter(i => i.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 3),
      topLosers: insights.filter(i => i.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 3)
    };

    res.json({
      success: true,
      insights,
      summary: marketSummary,
      type,
      symbols: symbolsArray
    });
  } catch (error) {
    logger.error('Get market insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch market insights'
    });
  }
};

const getEconomicCalendar = async (req, res) => {
  try {
    const { start, end } = req.query;

    const defaultStart = start || new Date().toISOString().split('T')[0];
    const defaultEnd = end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const calendar = await alpacaService.getMarketCalendar(defaultStart, defaultEnd);

    const economicEvents = [
      {
        id: 'fed-meeting-1',
        title: 'Federal Reserve Meeting',
        description: 'FOMC monetary policy decision and press conference',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        time: '14:00',
        impact: 'high',
        category: 'monetary-policy',
        country: 'US'
      },
      {
        id: 'unemployment-1',
        title: 'Unemployment Rate',
        description: 'Monthly unemployment rate release',
        date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        time: '08:30',
        impact: 'medium',
        category: 'employment',
        country: 'US'
      },
      {
        id: 'cpi-1',
        title: 'Consumer Price Index (CPI)',
        description: 'Monthly inflation data release',
        date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        time: '08:30',
        impact: 'high',
        category: 'inflation',
        country: 'US'
      }
    ];

    const formattedCalendar = calendar.map(day => ({
      date: day.date,
      marketOpen: day.open,
      marketClose: day.close,
      sessionOpen: day.session_open,
      sessionClose: day.session_close,
      isHoliday: !day.open || !day.close,
      events: economicEvents.filter(event => event.date === day.date)
    }));

    res.json({
      success: true,
      calendar: formattedCalendar,
      economicEvents: economicEvents.filter(event =>
        event.date >= defaultStart && event.date <= defaultEnd
      ),
      period: {
        start: defaultStart,
        end: defaultEnd
      },
      count: formattedCalendar.length
    });
  } catch (error) {
    logger.error('Get economic calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch economic calendar'
    });
  }
};

const getMarketAnalysis = async (req, res) => {
  try {
    const { symbol, period = '1M' } = req.query;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: 'Symbol parameter is required'
      });
    }

    let days;
    switch (period) {
      case '1D': days = 1; break;
      case '1W': days = 7; break;
      case '1M': days = 30; break;
      case '3M': days = 90; break;
      case '1Y': days = 365; break;
      default: days = 30;
    }

    const [asset, quote, bars, news] = await Promise.all([
      alpacaService.getAsset(symbol.toUpperCase()),
      alpacaService.getLatestQuote(symbol.toUpperCase()),
      alpacaService.getBars(symbol.toUpperCase(), '1Day', null, null, days + 10),
      alpacaService.getNews([symbol.toUpperCase()], 5)
    ]);

    const currentPrice = quote.ap || quote.bp;
    const prices = bars.map(bar => parseFloat(bar.c));

    let analysis = {
      symbol: symbol.toUpperCase(),
      name: asset.name,
      currentPrice,
      period,
      technicalIndicators: {},
      fundamentalMetrics: {
        tradable: asset.tradable,
        marginable: asset.marginable,
        shortable: asset.shortable,
        fractionable: asset.fractionable
      },
      priceTargets: {},
      riskMetrics: {},
      recentNews: news.slice(0, 3).map(article => ({
        headline: article.headline,
        summary: article.summary,
        publishedAt: article.published_at,
        url: article.url
      }))
    };

    if (prices.length >= 20) {
      const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const sma50 = prices.length >= 50 ? prices.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;

      const returns = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }

      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance) * Math.sqrt(252);

      analysis.technicalIndicators = {
        sma20: parseFloat(sma20.toFixed(2)),
        sma50: sma50 ? parseFloat(sma50.toFixed(2)) : null,
        rsi: calculateRSI(prices.slice(-14)),
        bollinger: calculateBollingerBands(prices.slice(-20), sma20),
        support: parseFloat(Math.min(...prices.slice(-30)).toFixed(2)),
        resistance: parseFloat(Math.max(...prices.slice(-30)).toFixed(2))
      };

      analysis.riskMetrics = {
        volatility: parseFloat((volatility * 100).toFixed(2)),
        beta: 1.0, // Would need market data to calculate actual beta
        sharpeRatio: avgReturn / Math.sqrt(variance),
        maxDrawdown: calculateMaxDrawdown(prices)
      };

      const priceChange = (currentPrice - prices[0]) / prices[0];
      analysis.priceTargets = {
        bullishTarget: parseFloat((currentPrice * 1.15).toFixed(2)),
        bearishTarget: parseFloat((currentPrice * 0.85).toFixed(2)),
        analyst_rating: priceChange > 0.1 ? 'BUY' : priceChange < -0.1 ? 'SELL' : 'HOLD'
      };
    }

    res.json({
      success: true,
      analysis,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Get market analysis error:', error);

    if (error.message.includes('symbol not found')) {
      return res.status(404).json({
        success: false,
        message: 'Symbol not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch market analysis'
    });
  }
};

const calculateRSI = (prices, period = 14) => {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[prices.length - i] - prices[prices.length - i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
};

const calculateBollingerBands = (prices, sma, period = 20) => {
  if (prices.length < period) return null;

  const variance = prices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: parseFloat((sma + 2 * stdDev).toFixed(2)),
    middle: parseFloat(sma.toFixed(2)),
    lower: parseFloat((sma - 2 * stdDev).toFixed(2))
  };
};

const calculateMaxDrawdown = (prices) => {
  let maxDrawdown = 0;
  let peak = prices[0];

  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > peak) {
      peak = prices[i];
    } else {
      const drawdown = (peak - prices[i]) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
  }

  return parseFloat((maxDrawdown * 100).toFixed(2));
};

module.exports = {
  getMarketNews,
  getEducationalContent,
  getMarketInsights,
  getEconomicCalendar,
  getMarketAnalysis
};