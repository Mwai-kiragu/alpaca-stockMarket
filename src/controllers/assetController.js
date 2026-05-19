const alpacaService = require('../services/alpacaService');
const ms = require('../services/mystocksService');
const logger = require('../utils/logger');
const Watchlist = require('../models/Watchlist');

const AFRICAN_EXCHANGES = new Set(['NSE', 'NGX', 'JSE', 'GSE', 'BRVM', 'LUSE', 'EGX', 'BSE', 'SEM']);
const isAfrican = (exchange) => !!exchange && AFRICAN_EXCHANGES.has(exchange.toUpperCase());

const ASSET_CATEGORIES = [
  { id: 'us_equity', label: 'US Stocks', description: 'Equities listed on US exchanges', provider: 'alpaca', type: 'equity', region: 'US' },
  { id: 'us_etf',   label: 'US ETFs',   description: 'Exchange-traded funds on US exchanges', provider: 'alpaca', type: 'etf',    region: 'US' },
  { id: 'crypto',   label: 'Crypto',    description: 'Cryptocurrency assets', provider: 'alpaca', type: 'crypto',  region: 'Global' },
  { id: 'NSE',  label: 'NSE — Nairobi',     description: 'Nairobi Securities Exchange (Kenya)',       provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'NSE',  currency: 'KES' },
  { id: 'NGX',  label: 'NGX — Lagos',       description: 'Nigerian Exchange Group (Nigeria)',         provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'NGX',  currency: 'NGN' },
  { id: 'JSE',  label: 'JSE — Johannesburg', description: 'Johannesburg Stock Exchange (South Africa)', provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'JSE', currency: 'ZAR' },
  { id: 'GSE',  label: 'GSE — Accra',       description: 'Ghana Stock Exchange (Ghana)',              provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'GSE',  currency: 'GHS' },
  { id: 'BRVM', label: 'BRVM — Abidjan',    description: 'Bourse Régionale des Valeurs Mobilières (West Africa)', provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'BRVM', currency: 'XOF' },
  { id: 'LUSE', label: 'LUSE — Lusaka',     description: 'Lusaka Securities Exchange (Zambia)',       provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'LUSE', currency: 'ZMW' },
  { id: 'EGX',  label: 'EGX — Cairo',       description: 'Egyptian Exchange (Egypt)',                 provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'EGX',  currency: 'EGP' },
  { id: 'BSE',  label: 'BSE — Gaborone',    description: 'Botswana Stock Exchange (Botswana)',        provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'BSE',  currency: 'BWP' },
  { id: 'SEM',  label: 'SEM — Port Louis',  description: 'Stock Exchange of Mauritius (Mauritius)',  provider: 'mystocks', type: 'equity', region: 'Africa', exchange: 'SEM',  currency: 'MUR' },
];

const getAssetCategories = (req, res) => {
  const grouped = {
    us: ASSET_CATEGORIES.filter(c => c.region === 'US'),
    africa: ASSET_CATEGORIES.filter(c => c.region === 'Africa'),
    global: ASSET_CATEGORIES.filter(c => c.region === 'Global'),
  };
  res.json({ success: true, categories: ASSET_CATEGORIES, grouped });
};

const getAssets = async (req, res) => {
  try {
    const {
      status = 'active',
      assetClass: assetClassCamel,
      asset_class: assetClassSnake,
      exchange,
      page = 1,
      limit = 20,
      search,
      sector,
      category,
      isWatchlist
    } = req.query;
    // Accept both assetClass and asset_class query params
    const assetClass = assetClassCamel || assetClassSnake || 'us_equity';

    let assets;
    let isPopular = false;
    let isWatchlistOnly = false;

    // Fetch user's watchlist symbols to mark assets that are in watchlist
    let userWatchlistSymbols = [];
    try {
      const userWatchlist = await Watchlist.findOne({
        where: { user_id: req.user.id }
      });
      if (userWatchlist && Array.isArray(userWatchlist.symbols)) {
        userWatchlistSymbols = userWatchlist.symbols.map(s => s.toUpperCase());
      }
    } catch (watchlistError) {
      logger.warn('Failed to fetch user watchlist:', watchlistError);
    }

    // Check if requesting watchlist-prioritized view
    if (isWatchlist === 'true') {
      isWatchlistOnly = true;
    }

    // Resolve African exchange — can come from ?exchange=NSE or ?asset_class=NSE
    const africanExchange = isAfrican(exchange) ? exchange : (isAfrican(assetClass) ? assetClass : null);

    // African exchange → MyStocks stocks list
    if (africanExchange) {
      const exchange = africanExchange; // shadow outer for consistency below
      // MyStocks ignores `search` when `exchange` is also provided — fetch by search only
      // then filter by exchange client-side, or fetch by exchange when no search term.
      const data = search
        ? await ms.getStocks({ search })
        : await ms.getStocks({ exchange: exchange.toUpperCase(), sector });
      let all = Array.isArray(data) ? data : (Array.isArray(data?.stocks) ? data.stocks : []);
      if (search) {
        const exch = exchange.toUpperCase();
        all = all.filter(a => a.exchange === exch || (a.symbol || '').toUpperCase().endsWith(`.${exch.slice(0, 2)}`));
      }
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
      const start = (pageNum - 1) * limitNum;
      const paginated = all.slice(start, start + limitNum).map(asset => ({
        ...asset,
        logo: `/api/v1/assets/logo/${asset.symbol}`
      }));
      return res.json({
        success: true,
        provider: 'mystocks',
        assets: paginated,
        count: paginated.length,
        total: all.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(all.length / limitNum)
      });
    }

    if (category === 'popular') {
      isPopular = true;

      // Fetch most active stocks dynamically from Alpaca
      const popularSymbols = await alpacaService.getMostActiveStocks(30);

      const popularAssets = {};

      await Promise.allSettled(
        popularSymbols.map(async (symbol) => {
          try {
            const [asset, quote, bars] = await Promise.all([
              alpacaService.getAsset(symbol),
              alpacaService.getLatestQuote(symbol),
              alpacaService.getBars(symbol, '1Day', null, null, 2)
            ]);

            let changePercent = 0;
            if (bars.length >= 2) {
              const currentPrice = quote.ap || quote.bp;
              const previousClose = parseFloat(bars[bars.length - 2].c);
              changePercent = ((currentPrice - previousClose) / previousClose) * 100;
            }

            popularAssets[symbol] = {
              symbol: asset.symbol,
              name: asset.name, // This will now contain the full company name from alpacaService.getCompanyName()
              logo: asset.logo, // Company logo URL
              exchange: asset.exchange,
              class: asset.class,
              asset_class: asset.class,
              status: asset.status,
              tradable: asset.tradable,
              marginable: asset.marginable,
              shortable: asset.shortable,
              easy_to_borrow: asset.easy_to_borrow,
              fractionable: asset.fractionable,
              currentPrice: quote.ap || quote.bp,
              changePercent: parseFloat(changePercent.toFixed(2)),
              volume: bars.length > 0 ? parseInt(bars[bars.length - 1].v || 0) : 0,
              high: bars.length > 0 ? parseFloat(bars[bars.length - 1].h || 0) : 0,
              low: bars.length > 0 ? parseFloat(bars[bars.length - 1].l || 0) : 0,
              lastUpdated: quote.t
            };
          } catch (error) {
            logger.warn(`Failed to get data for popular asset ${symbol}:`, error);
          }
        })
      );

      assets = Object.values(popularAssets).sort((a, b) => b.volume - a.volume);
    } else {
      // Regular assets fetch
      assets = await alpacaService.getAssets(status, assetClass, exchange);

      // Filter to show only tradable assets by default for better UX
      assets = assets.filter(asset => asset.tradable === true && asset.status === 'active');

      // When asset_class is us_equity, exclude ETFs (which have class 'us_etf' or 'etf')
      if (assetClass === 'us_equity') {
        assets = assets.filter(asset => {
          const assetClassLower = (asset.class || asset.asset_class || '').toLowerCase();
          return !assetClassLower.includes('etf');
        });
      }

      // Sort assets to prioritize major exchanges and exclude problematic asset types
      assets = assets.sort((a, b) => {
        // Prioritize major exchanges
        const exchangeOrder = { 'NASDAQ': 1, 'NYSE': 2, 'ARCA': 3, 'BATS': 4, 'AMEX': 5 };
        const aExchange = exchangeOrder[a.exchange] || 99;
        const bExchange = exchangeOrder[b.exchange] || 99;

        if (aExchange !== bExchange) {
          return aExchange - bExchange;
        }

        // Deprioritize warrants and complex instruments that often have data issues
        const isProblematic = (symbol) => {
          return symbol.includes('.WS') || symbol.includes('W') && symbol.length > 4 ||
                 symbol.includes('SPAC') || symbol.includes('PIPE') ||
                 symbol.endsWith('W') || symbol.endsWith('.WS');
        };

        const aProblematic = isProblematic(a.symbol);
        const bProblematic = isProblematic(b.symbol);

        if (aProblematic && !bProblematic) return 1;
        if (!aProblematic && bProblematic) return -1;

        return a.symbol.localeCompare(b.symbol);
      });
    }

    // Apply search filter if provided
    if (search && search.trim()) {
      const searchLower = search.toLowerCase();
      assets = assets.filter(asset =>
        asset.symbol.toLowerCase().includes(searchLower) ||
        asset.name.toLowerCase().includes(searchLower)
      );
    }

    // Sort to prioritize watchlist items if isWatchlist flag is set
    if (isWatchlistOnly && userWatchlistSymbols.length > 0) {
      assets = assets.sort((a, b) => {
        const aInWatchlist = userWatchlistSymbols.includes(a.symbol.toUpperCase());
        const bInWatchlist = userWatchlistSymbols.includes(b.symbol.toUpperCase());

        // Watchlist items first
        if (aInWatchlist && !bInWatchlist) return -1;
        if (!aInWatchlist && bInWatchlist) return 1;

        // Within same group, maintain existing order
        return 0;
      });
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100); // Max 100 items per page
    const totalItems = assets.length;
    const totalPages = Math.ceil(totalItems / limitNum);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;

    // Get paginated assets
    const paginatedAssets = assets.slice(startIndex, endIndex);

    const formattedAssets = await Promise.allSettled(
      paginatedAssets.map(async (asset) => {
        const baseAsset = {
          symbol: asset.symbol,
          name: asset.name,
          logo: asset.logo, // Company logo URL
          exchange: asset.exchange,
          assetClass: asset.class || asset.asset_class,
          status: asset.status,
          tradable: asset.tradable,
          marginable: asset.marginable,
          shortable: asset.shortable,
          easyToBorrow: asset.easy_to_borrow,
          fractionable: asset.fractionable,
          inWatchlist: userWatchlistSymbols.includes(asset.symbol.toUpperCase())
        };

        // Add market data for popular, watchlist, and regular assets
        try {
          if ((isPopular || isWatchlistOnly) && asset.currentPrice) {
            // Popular and watchlist assets already have market data
            baseAsset.marketData = {
              currentPrice: asset.currentPrice,
              change: asset.change || asset.currentPrice * (asset.changePercent / 100),
              changePercent: asset.changePercent,
              volume: asset.volume,
              high: asset.high || 0,
              low: asset.low || 0,
              lastUpdated: asset.lastUpdated,
              isProfit: asset.changePercent >= 0
            };

            // Add inWatchlist field if it exists
            if (asset.inWatchlist !== undefined) {
              baseAsset.inWatchlist = asset.inWatchlist;
            }
          } else if (asset.tradable && asset.status === 'active') {
            // Fetch market data for regular tradable assets with timeout
            const marketDataPromise = Promise.race([
              Promise.all([
                alpacaService.getLatestQuote(asset.symbol),
                alpacaService.getBars(asset.symbol, '1Day', null, null, 2)
              ]),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Market data timeout')), 5000)
              )
            ]);

            const [quote, bars] = await marketDataPromise;

            // Generate logo from the company name we already have
            baseAsset.logo = alpacaService.getCompanyLogo(asset.symbol, asset.name);

            let changePercent = 0;
            let change = 0;
            const currentPrice = quote.ap || quote.bp || 0;

            if (bars.length >= 2 && currentPrice > 0) {
              const previousClose = parseFloat(bars[bars.length - 2].c);
              change = currentPrice - previousClose;
              changePercent = (change / previousClose) * 100;
            }

            baseAsset.marketData = {
              currentPrice: parseFloat(currentPrice.toFixed(2)),
              change: parseFloat(change.toFixed(2)),
              changePercent: parseFloat(changePercent.toFixed(2)),
              volume: bars.length > 0 ? parseInt(bars[bars.length - 1].v || 0) : 0,
              high: bars.length > 0 ? parseFloat(bars[bars.length - 1].h || 0) : 0,
              low: bars.length > 0 ? parseFloat(bars[bars.length - 1].l || 0) : 0,
              lastUpdated: quote.t,
              isProfit: changePercent >= 0
            };
          } else {
            // Non-tradable assets get null market data
            baseAsset.marketData = null;
          }
        } catch (marketError) {
          logger.warn(`Failed to get market data for ${asset.symbol}:`, marketError.message);
          // Provide a more informative null market data structure
          baseAsset.marketData = {
            currentPrice: null,
            change: null,
            changePercent: null,
            volume: null,
            high: null,
            low: null,
            lastUpdated: null,
            isProfit: null,
            unavailable: true,
            reason: 'Market data temporarily unavailable'
          };
        }

        return baseAsset;
      })
    );

    // Filter successful results and handle failed ones
    const successfulAssets = formattedAssets
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);

    res.json({
      success: true,
      assets: successfulAssets,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      filters: {
        status,
        assetClass,
        exchange: exchange || 'all',
        search: search || null,
        category: category || 'all'
      }
    });
  } catch (error) {
    logger.error('Get assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assets'
    });
  }
};

const getAsset = async (req, res) => {
  try {
    const { symbol } = req.params;

    const asset = await alpacaService.getAsset(symbol.toUpperCase());

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    const formattedAsset = {
      symbol: asset.symbol,
      name: asset.name,
      logo: asset.logo,
      exchange: asset.exchange,
      assetClass: asset.class,
      status: asset.status,
      tradable: asset.tradable,
      marginable: asset.marginable,
      shortable: asset.shortable,
      easyToBorrow: asset.easy_to_borrow,
      fractionable: asset.fractionable,
      attributes: asset.attributes || []
    };

    try {
      const quote = await alpacaService.getLatestQuote(symbol.toUpperCase());
      const bars = await alpacaService.getBars(symbol.toUpperCase(), '1Day', null, null, 2);

      formattedAsset.marketData = {
        currentPrice: quote.ap || quote.bp,
        askPrice: quote.ap,
        bidPrice: quote.bp,
        askSize: quote.as,
        bidSize: quote.bs,
        lastUpdated: quote.t
      };

      if (bars.length >= 2) {
        const currentPrice = formattedAsset.marketData.currentPrice;
        const previousClose = parseFloat(bars[bars.length - 2].c);
        const change = currentPrice - previousClose;
        const changePercent = (change / previousClose) * 100;

        formattedAsset.priceInfo = {
          change: parseFloat(change.toFixed(2)),
          changePercent: parseFloat(changePercent.toFixed(2)),
          previousClose,
          volume: parseInt(bars[bars.length - 1].v || 0),
          high: parseFloat(bars[bars.length - 1].h),
          low: parseFloat(bars[bars.length - 1].l),
          open: parseFloat(bars[bars.length - 1].o)
        };
      }
    } catch (marketDataError) {
      logger.warn(`Failed to get market data for ${symbol}:`, marketDataError);
      formattedAsset.marketData = null;
      formattedAsset.priceInfo = null;
    }

    res.json({
      success: true,
      asset: formattedAsset
    });
  } catch (error) {
    logger.error(`Get asset error for ${symbol}:`, error);

    if (error.message.includes('asset not found') || error.message.includes('404')) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch asset details'
    });
  }
};

const searchAssets = async (req, res) => {
  try {
    const { query, limit = 50 } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    const assets = await alpacaService.getAssets('active', 'us_equity');

    const searchQuery = query.toLowerCase().trim();
    const filteredAssets = assets.filter(asset =>
      asset.symbol.toLowerCase().includes(searchQuery) ||
      asset.name.toLowerCase().includes(searchQuery)
    );

    const limitedResults = filteredAssets.slice(0, Math.min(parseInt(limit), 100));

    const formattedResults = limitedResults.map(asset => ({
      symbol: asset.symbol,
      name: asset.name,
      logo: alpacaService.getCompanyLogo(asset.symbol, asset.name),
      exchange: asset.exchange,
      assetClass: asset.class,
      tradable: asset.tradable,
      fractionable: asset.fractionable
    }));

    res.json({
      success: true,
      results: formattedResults,
      count: formattedResults.length,
      totalMatches: filteredAssets.length,
      query: searchQuery,
      limited: filteredAssets.length > parseInt(limit)
    });
  } catch (error) {
    logger.error('Search assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search assets'
    });
  }
};

const getTradableAssets = async (req, res) => {
  try {
    const { exchange, limit = 100 } = req.query;

    const assets = await alpacaService.getAssets('active', 'us_equity', exchange);

    const tradableAssets = assets.filter(asset =>
      asset.tradable === true && asset.status === 'active'
    );

    const limitedAssets = tradableAssets.slice(0, Math.min(parseInt(limit), 500));

    const formattedAssets = await Promise.allSettled(
      limitedAssets.map(async (asset) => {
        const baseAsset = {
          symbol: asset.symbol,
          name: asset.name,
          logo: alpacaService.getCompanyLogo(asset.symbol, asset.name),
          exchange: asset.exchange,
          assetClass: asset.class,
          marginable: asset.marginable,
          shortable: asset.shortable,
          fractionable: asset.fractionable
        };

        try {
          const quote = await alpacaService.getLatestQuote(asset.symbol);
          baseAsset.currentPrice = quote.ap || quote.bp;
          baseAsset.lastUpdated = quote.t;
        } catch (quoteError) {
          logger.debug(`No quote available for ${asset.symbol}:`, quoteError.message);
          baseAsset.currentPrice = null;
          baseAsset.lastUpdated = null;
        }

        return baseAsset;
      })
    );

    const successfulResults = formattedAssets
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);

    res.json({
      success: true,
      assets: successfulResults,
      count: successfulResults.length,
      filters: {
        exchange: exchange || 'all',
        status: 'active',
        tradable: true
      }
    });
  } catch (error) {
    logger.error('Get tradable assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tradable assets'
    });
  }
};

const getPopularAssets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search
    } = req.query;

    // Fetch most active stocks dynamically from Alpaca
    const popularSymbols = await alpacaService.getMostActiveStocks(30);

    const assets = {};

    await Promise.allSettled(
      popularSymbols.map(async (symbol) => {
        try {
          const [asset, quote, bars] = await Promise.all([
            alpacaService.getAsset(symbol),
            alpacaService.getLatestQuote(symbol),
            alpacaService.getBars(symbol, '1Day', null, null, 2)
          ]);

          let changePercent = 0;
          if (bars.length >= 2) {
            const currentPrice = quote.ap || quote.bp;
            const previousClose = parseFloat(bars[bars.length - 2].c);
            changePercent = ((currentPrice - previousClose) / previousClose) * 100;
          }

          assets[symbol] = {
            symbol: asset.symbol,
            name: asset.name, // This will now contain the full company name from alpacaService.getCompanyName()
            logo: asset.logo, // Company logo URL
            exchange: asset.exchange,
            currentPrice: quote.ap || quote.bp,
            changePercent: parseFloat(changePercent.toFixed(2)),
            volume: bars.length > 0 ? parseInt(bars[bars.length - 1].v || 0) : 0,
            tradable: asset.tradable,
            fractionable: asset.fractionable,
            lastUpdated: quote.t
          };
        } catch (error) {
          logger.warn(`Failed to get data for popular asset ${symbol}:`, error);
        }
      })
    );

    let popularAssets = Object.values(assets)
      .sort((a, b) => b.volume - a.volume);

    // Apply search filter if provided
    if (search && search.trim()) {
      const searchLower = search.toLowerCase();
      popularAssets = popularAssets.filter(asset =>
        asset.symbol.toLowerCase().includes(searchLower) ||
        asset.name.toLowerCase().includes(searchLower)
      );
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100); // Max 100 items per page
    const totalItems = popularAssets.length;
    const totalPages = Math.ceil(totalItems / limitNum);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;

    // Get paginated assets
    const paginatedAssets = popularAssets.slice(startIndex, endIndex);

    res.json({
      success: true,
      assets: paginatedAssets,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      filters: {
        search: search || null,
        category: 'popular'
      },
      count: paginatedAssets.length
    });
  } catch (error) {
    logger.error('Get popular assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch popular assets'
    });
  }
};

const getAssetsByExchange = async (req, res) => {
  try {
    const { exchange } = req.params;
    const { limit = 100 } = req.query;

    const validExchanges = ['NASDAQ', 'NYSE', 'ARCA', 'BATS'];
    if (!validExchanges.includes(exchange.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid exchange. Valid exchanges: ${validExchanges.join(', ')}`
      });
    }

    const assets = await alpacaService.getAssets('active', 'us_equity', exchange.toUpperCase());

    const tradableAssets = assets
      .filter(asset => asset.tradable === true)
      .slice(0, Math.min(parseInt(limit), 200));

    const formattedAssets = tradableAssets.map(asset => ({
      symbol: asset.symbol,
      name: asset.name,
      logo: alpacaService.getCompanyLogo(asset.symbol, asset.name),
      exchange: asset.exchange,
      assetClass: asset.class,
      tradable: asset.tradable,
      marginable: asset.marginable,
      shortable: asset.shortable,
      fractionable: asset.fractionable
    }));

    res.json({
      success: true,
      assets: formattedAssets,
      count: formattedAssets.length,
      exchange: exchange.toUpperCase(),
      totalAvailable: assets.length
    });
  } catch (error) {
    logger.error(`Get assets by exchange error for ${exchange}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exchange assets'
    });
  }
};

module.exports = {
  getAssets,
  getAsset,
  searchAssets,
  getTradableAssets,
  getPopularAssets,
  getAssetsByExchange,
  getAssetCategories
};