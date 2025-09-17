const alpacaService = require('../services/alpacaService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const searchStocks = async (req, res) => {
  try {
    const { q: query, limit = 20, exchange, minPrice, maxPrice } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    const searchQuery = query.toLowerCase().trim();

    let assets = await alpacaService.getAssets('active', 'us_equity', exchange);

    const filteredAssets = assets.filter(asset =>
      asset.tradable &&
      (asset.symbol.toLowerCase().includes(searchQuery) ||
       asset.name.toLowerCase().includes(searchQuery))
    );

    const limitedResults = filteredAssets.slice(0, Math.min(parseInt(limit), 50));

    const results = await Promise.allSettled(
      limitedResults.map(async (asset) => {
        const baseResult = {
          symbol: asset.symbol,
          name: asset.name,
          exchange: asset.exchange,
          assetClass: asset.class,
          tradable: asset.tradable,
          fractionable: asset.fractionable,
          marginable: asset.marginable
        };

        try {
          const quote = await alpacaService.getLatestQuote(asset.symbol);
          const currentPrice = quote.ap || quote.bp;

          if (minPrice && currentPrice < parseFloat(minPrice)) return null;
          if (maxPrice && currentPrice > parseFloat(maxPrice)) return null;

          baseResult.currentPrice = currentPrice;
          baseResult.askPrice = quote.ap;
          baseResult.bidPrice = quote.bp;
          baseResult.lastUpdated = quote.t;

          const bars = await alpacaService.getBars(asset.symbol, '1Day', null, null, 2);
          if (bars.length >= 2) {
            const previousClose = parseFloat(bars[bars.length - 2].c);
            const change = currentPrice - previousClose;
            const changePercent = (change / previousClose) * 100;

            baseResult.change = parseFloat(change.toFixed(2));
            baseResult.changePercent = parseFloat(changePercent.toFixed(2));
            baseResult.volume = parseInt(bars[bars.length - 1]?.v || 0);
          }

          return baseResult;
        } catch (quoteError) {
          logger.warn(`Failed to get quote for ${asset.symbol}:`, quoteError);
          return baseResult;
        }
      })
    );

    const validResults = results
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value)
      .sort((a, b) => {
        if (a.symbol.toLowerCase().startsWith(searchQuery) && !b.symbol.toLowerCase().startsWith(searchQuery)) return -1;
        if (!a.symbol.toLowerCase().startsWith(searchQuery) && b.symbol.toLowerCase().startsWith(searchQuery)) return 1;
        return a.symbol.localeCompare(b.symbol);
      });

    res.json({
      success: true,
      results: validResults,
      count: validResults.length,
      totalMatches: filteredAssets.length,
      query: searchQuery,
      filters: {
        exchange: exchange || 'all',
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
        limit: parseInt(limit)
      },
      limited: filteredAssets.length > parseInt(limit)
    });
  } catch (error) {
    logger.error('Search stocks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search stocks'
    });
  }
};

const searchByCategory = async (req, res) => {
  try {
    const { category, limit = 20 } = req.query;

    const categoryMap = {
      'tech': ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'META', 'TSLA', 'NVDA', 'NFLX', 'ADBE', 'CRM', 'INTC', 'AMD', 'ORCL', 'IBM', 'CSCO'],
      'finance': ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP', 'BLK', 'SCHW', 'USB', 'PNC', 'TFC', 'COF', 'AFL', 'MET'],
      'healthcare': ['JNJ', 'UNH', 'PFE', 'ABT', 'TMO', 'MRK', 'ABBV', 'DHR', 'BMY', 'LLY', 'AMGN', 'GILD', 'CVS', 'MDT', 'ISRG'],
      'retail': ['WMT', 'HD', 'TGT', 'LOW', 'COST', 'NKE', 'SBUX', 'MCD', 'DIS', 'EBAY', 'ETSY', 'LULU', 'RH', 'BBY', 'GPS'],
      'energy': ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'PXD', 'KMI', 'OKE', 'WMB', 'MPC', 'PSX', 'VLO', 'HES', 'DVN', 'FANG'],
      'etf': ['SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'VEA', 'VWO', 'IEFA', 'EFA', 'EEM', 'AGG', 'TLT', 'GLD', 'SLV', 'USO']
    };

    if (!category || !categoryMap[category.toLowerCase()]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category',
        availableCategories: Object.keys(categoryMap)
      });
    }

    const symbols = categoryMap[category.toLowerCase()].slice(0, Math.min(parseInt(limit), 30));
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const [asset, quote, bars] = await Promise.all([
            alpacaService.getAsset(symbol),
            alpacaService.getLatestQuote(symbol),
            alpacaService.getBars(symbol, '1Day', null, null, 2)
          ]);

          const currentPrice = quote.ap || quote.bp;
          let change = 0;
          let changePercent = 0;

          if (bars.length >= 2) {
            const previousClose = parseFloat(bars[bars.length - 2].c);
            change = currentPrice - previousClose;
            changePercent = (change / previousClose) * 100;
          }

          return {
            symbol: asset.symbol,
            name: asset.name,
            exchange: asset.exchange,
            currentPrice,
            currentPriceKES: currentPrice * exchangeRate,
            change: parseFloat(change.toFixed(2)),
            changeKES: parseFloat((change * exchangeRate).toFixed(2)),
            changePercent: parseFloat(changePercent.toFixed(2)),
            volume: bars.length > 0 ? parseInt(bars[bars.length - 1]?.v || 0) : 0,
            tradable: asset.tradable,
            fractionable: asset.fractionable,
            marginable: asset.marginable,
            lastUpdated: quote.t
          };
        } catch (symbolError) {
          logger.warn(`Failed to get data for ${symbol}:`, symbolError);
          return null;
        }
      })
    );

    const validResults = results
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value)
      .sort((a, b) => b.volume - a.volume);

    res.json({
      success: true,
      results: validResults,
      count: validResults.length,
      category: category.toLowerCase(),
      exchangeRate,
      summary: {
        totalVolume: validResults.reduce((sum, stock) => sum + stock.volume, 0),
        gainers: validResults.filter(s => s.changePercent > 0).length,
        losers: validResults.filter(s => s.changePercent < 0).length,
        avgChange: validResults.length > 0 ?
          (validResults.reduce((sum, s) => sum + s.changePercent, 0) / validResults.length).toFixed(2) : 0
      }
    });
  } catch (error) {
    logger.error('Search by category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search by category'
    });
  }
};

const getTrendingStocks = async (req, res) => {
  try {
    const { limit = 20, timeframe = '1Day' } = req.query;

    const popularSymbols = [
      'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX',
      'BABA', 'V', 'JPM', 'JNJ', 'WMT', 'PG', 'UNH', 'HD', 'MA', 'BAC',
      'DIS', 'ADBE', 'CRM', 'PYPL', 'INTC', 'CMCSA', 'PFE', 'VZ',
      'T', 'ABT', 'NKE', 'MRK', 'KO', 'PEP', 'XOM', 'CVX', 'WFC'
    ];

    const results = await Promise.allSettled(
      popularSymbols.slice(0, Math.min(parseInt(limit), 50)).map(async (symbol) => {
        try {
          const [quote, bars] = await Promise.all([
            alpacaService.getLatestQuote(symbol),
            alpacaService.getBars(symbol, timeframe, null, null, 5)
          ]);

          if (bars.length < 2) return null;

          const currentPrice = quote.ap || quote.bp;
          const previousClose = parseFloat(bars[bars.length - 2].c);
          const change = currentPrice - previousClose;
          const changePercent = (change / previousClose) * 100;
          const volume = parseInt(bars[bars.length - 1]?.v || 0);

          let volatility = 0;
          if (bars.length >= 3) {
            const returns = [];
            for (let i = 1; i < bars.length; i++) {
              const dailyReturn = (parseFloat(bars[i].c) - parseFloat(bars[i - 1].c)) / parseFloat(bars[i - 1].c);
              returns.push(Math.abs(dailyReturn));
            }
            volatility = returns.reduce((a, b) => a + b, 0) / returns.length;
          }

          const avgVolume = bars.slice(-5).reduce((sum, bar) => sum + parseInt(bar.v || 0), 0) / Math.min(bars.length, 5);
          const volumeRatio = volume / avgVolume;

          const trendingScore = (Math.abs(changePercent) * 0.4) + (volatility * 100 * 0.3) + (volumeRatio * 0.3);

          return {
            symbol,
            currentPrice,
            change: parseFloat(change.toFixed(2)),
            changePercent: parseFloat(changePercent.toFixed(2)),
            volume,
            avgVolume: Math.round(avgVolume),
            volumeRatio: parseFloat(volumeRatio.toFixed(2)),
            volatility: parseFloat((volatility * 100).toFixed(2)),
            trendingScore: parseFloat(trendingScore.toFixed(2)),
            lastUpdated: quote.t
          };
        } catch (symbolError) {
          logger.warn(`Failed to get trending data for ${symbol}:`, symbolError);
          return null;
        }
      })
    );

    const validResults = results
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value)
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, parseInt(limit));

    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const formattedResults = validResults.map(stock => ({
      ...stock,
      currentPriceKES: stock.currentPrice * exchangeRate,
      changeKES: stock.change * exchangeRate
    }));

    res.json({
      success: true,
      trending: formattedResults,
      count: formattedResults.length,
      timeframe,
      exchangeRate,
      summary: {
        topGainer: formattedResults.reduce((max, stock) =>
          stock.changePercent > max.changePercent ? stock : max, formattedResults[0]),
        topLoser: formattedResults.reduce((min, stock) =>
          stock.changePercent < min.changePercent ? stock : min, formattedResults[0]),
        highestVolume: formattedResults.reduce((max, stock) =>
          stock.volume > max.volume ? stock : max, formattedResults[0]),
        mostVolatile: formattedResults.reduce((max, stock) =>
          stock.volatility > max.volatility ? stock : max, formattedResults[0])
      }
    });
  } catch (error) {
    logger.error('Get trending stocks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending stocks'
    });
  }
};

const getMarketMovers = async (req, res) => {
  try {
    const { type = 'gainers', limit = 10 } = req.query;

    if (!['gainers', 'losers', 'active'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Must be gainers, losers, or active'
      });
    }

    const symbols = [
      'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX',
      'BABA', 'V', 'JPM', 'JNJ', 'WMT', 'PG', 'UNH', 'HD', 'MA', 'BAC',
      'DIS', 'ADBE', 'CRM', 'PYPL', 'INTC', 'CMCSA', 'PFE', 'VZ', 'T',
      'ABT', 'NKE', 'MRK', 'KO', 'PEP', 'XOM', 'CVX', 'WFC', 'GS',
      'MS', 'ORCL', 'IBM', 'CSCO', 'TMO', 'DHR', 'BMY', 'LLY', 'ABBV'
    ];

    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const [asset, quote, bars] = await Promise.all([
            alpacaService.getAsset(symbol),
            alpacaService.getLatestQuote(symbol),
            alpacaService.getBars(symbol, '1Day', null, null, 2)
          ]);

          if (bars.length < 2) return null;

          const currentPrice = quote.ap || quote.bp;
          const previousClose = parseFloat(bars[bars.length - 2].c);
          const change = currentPrice - previousClose;
          const changePercent = (change / previousClose) * 100;
          const volume = parseInt(bars[bars.length - 1]?.v || 0);

          return {
            symbol,
            name: asset.name,
            currentPrice,
            change: parseFloat(change.toFixed(2)),
            changePercent: parseFloat(changePercent.toFixed(2)),
            volume,
            lastUpdated: quote.t
          };
        } catch (symbolError) {
          logger.warn(`Failed to get market mover data for ${symbol}:`, symbolError);
          return null;
        }
      })
    );

    const validResults = results
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value);

    let sortedResults;
    switch (type) {
      case 'gainers':
        sortedResults = validResults
          .filter(stock => stock.changePercent > 0)
          .sort((a, b) => b.changePercent - a.changePercent);
        break;
      case 'losers':
        sortedResults = validResults
          .filter(stock => stock.changePercent < 0)
          .sort((a, b) => a.changePercent - b.changePercent);
        break;
      case 'active':
        sortedResults = validResults.sort((a, b) => b.volume - a.volume);
        break;
    }

    const finalResults = sortedResults.slice(0, Math.min(parseInt(limit), 20));
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    const formattedResults = finalResults.map(stock => ({
      ...stock,
      currentPriceKES: stock.currentPrice * exchangeRate,
      changeKES: stock.change * exchangeRate
    }));

    res.json({
      success: true,
      movers: formattedResults,
      count: formattedResults.length,
      type,
      exchangeRate,
      summary: {
        totalVolume: formattedResults.reduce((sum, stock) => sum + stock.volume, 0),
        avgChange: formattedResults.length > 0 ?
          (formattedResults.reduce((sum, s) => sum + s.changePercent, 0) / formattedResults.length).toFixed(2) : 0,
        range: {
          highest: type === 'gainers' ? formattedResults[0]?.changePercent : Math.max(...formattedResults.map(s => s.changePercent)),
          lowest: type === 'losers' ? formattedResults[0]?.changePercent : Math.min(...formattedResults.map(s => s.changePercent))
        }
      }
    });
  } catch (error) {
    logger.error('Get market movers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch market movers'
    });
  }
};

module.exports = {
  searchStocks,
  searchByCategory,
  getTrendingStocks,
  getMarketMovers
};