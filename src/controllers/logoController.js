const axios = require('axios');
const logger = require('../utils/logger');

// Alpaca API credentials
const ALPACA_API_KEY = process.env.ALPACA_PAPER_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_PAPER_SECRET_KEY;

const isAfricanSymbol = (sym) => /\.[A-Z]{2,3}$/i.test(sym);

// In-memory cache for logos (1 hour TTL)
const logoCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Generate SVG placeholder with company initials
const generatePlaceholderSvg = (symbol) => {
  const colors = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#84CC16'];
  const colorIndex = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
  const bgColor = colors[colorIndex];
  const initials = symbol.substring(0, 2).toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="16" fill="${bgColor}"/>
    <text x="64" y="76" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white" text-anchor="middle">${initials}</text>
  </svg>`;
};

// Try to fetch logo from various symbol-based APIs (no hardcoding needed)
const fetchLogoFromSources = async (symbol) => {
  const symbolUpper = symbol.toUpperCase();

  // Check cache first
  const cached = logoCache.get(symbolUpper);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Source 0: MyStocks CDN — derive logo URL directly from symbol, no API call needed
  // Pattern: EVRD.KE → https://mystocks.africa/logos/evrd-ke.svg
  if (isAfricanSymbol(symbolUpper)) {
    try {
      const [ticker, suffix] = symbolUpper.split('.');
      const logoUrl = `https://mystocks.africa/logos/${ticker.toLowerCase()}-${suffix.toLowerCase()}.svg`;
      const imgRes = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 5000, validateStatus: (s) => s < 500 });
      if (imgRes.status === 200 && imgRes.data.length > 100) {
        const result = {
          data: imgRes.data,
          contentType: imgRes.headers['content-type'] || 'image/svg+xml',
          source: 'mystocks'
        };
        logoCache.set(symbolUpper, { data: result, timestamp: Date.now() });
        return result;
      }
    } catch (e) {
      logger.debug(`MyStocks CDN logo failed for ${symbolUpper}: ${e.message}`);
    }
  }

  // Source 1: Alpaca Logo API (best source - has all tradable assets)
  if (ALPACA_API_KEY && ALPACA_SECRET_KEY) {
    try {
      const alpacaUrl = `https://data.alpaca.markets/v1beta1/logos/${symbolUpper}`;
      const response = await axios.get(alpacaUrl, {
        responseType: 'arraybuffer',
        timeout: 5000,
        headers: {
          'APCA-API-KEY-ID': ALPACA_API_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY
        },
        validateStatus: (status) => status < 500
      });

      if (response.status === 200 && response.data.length > 100) {
        const result = {
          data: response.data,
          contentType: response.headers['content-type'] || 'image/png',
          source: 'alpaca'
        };
        logoCache.set(symbolUpper, { data: result, timestamp: Date.now() });
        logger.debug(`Logo fetched from Alpaca for ${symbolUpper}`);
        return result;
      }
    } catch (error) {
      logger.debug(`Alpaca logo failed for ${symbol}: ${error.message}`);
    }
  }

  // Source 2: TradingView (works with any symbol)
  try {
    const tradingViewUrl = `https://s3-symbol-logo.tradingview.com/${symbolUpper}--big.svg`;
    const response = await axios.get(tradingViewUrl, {
      responseType: 'arraybuffer',
      timeout: 3000,
      validateStatus: (status) => status < 500
    });

    if (response.status === 200 && response.data.length > 100) {
      const result = {
        data: response.data,
        contentType: 'image/svg+xml',
        source: 'tradingview'
      };
      logoCache.set(symbolUpper, { data: result, timestamp: Date.now() });
      return result;
    }
  } catch (error) {
    logger.debug(`TradingView failed for ${symbol}: ${error.message}`);
  }

  // Source 3: Logo.dev ticker API (works with stock symbols directly)
  try {
    const logoDevUrl = `https://img.logo.dev/ticker/${symbolUpper}?token=pk_X-1ZWK13RWiUoFmZdMwBnQ&size=128&format=png`;
    const response = await axios.get(logoDevUrl, {
      responseType: 'arraybuffer',
      timeout: 3000,
      validateStatus: (status) => status < 500
    });

    if (response.status === 200 && response.data.length > 500) {
      const result = {
        data: response.data,
        contentType: response.headers['content-type'] || 'image/png',
        source: 'logodev'
      };
      logoCache.set(symbolUpper, { data: result, timestamp: Date.now() });
      return result;
    }
  } catch (error) {
    logger.debug(`Logo.dev failed for ${symbol}: ${error.message}`);
  }

  // Source 4: Twelve Data (works with stock symbols)
  try {
    const twelveDataUrl = `https://api.twelvedata.com/logo?symbol=${symbolUpper}`;
    const response = await axios.get(twelveDataUrl, {
      timeout: 3000,
      validateStatus: (status) => status < 500
    });

    if (response.status === 200 && response.data?.url) {
      // Fetch the actual logo from the URL provided
      const logoResponse = await axios.get(response.data.url, {
        responseType: 'arraybuffer',
        timeout: 3000
      });

      if (logoResponse.status === 200) {
        const result = {
          data: logoResponse.data,
          contentType: logoResponse.headers['content-type'] || 'image/png',
          source: 'twelvedata'
        };
        logoCache.set(symbolUpper, { data: result, timestamp: Date.now() });
        return result;
      }
    }
  } catch (error) {
    logger.debug(`Twelve Data failed for ${symbol}: ${error.message}`);
  }

  // Source 5: Financial Modeling Prep (free tier)
  try {
    const fmpUrl = `https://financialmodelingprep.com/image-stock/${symbolUpper}.png`;
    const response = await axios.get(fmpUrl, {
      responseType: 'arraybuffer',
      timeout: 3000,
      validateStatus: (status) => status < 500
    });

    if (response.status === 200 && response.data.length > 500) {
      const result = {
        data: response.data,
        contentType: 'image/png',
        source: 'fmp'
      };
      logoCache.set(symbolUpper, { data: result, timestamp: Date.now() });
      return result;
    }
  } catch (error) {
    logger.debug(`FMP failed for ${symbol}: ${error.message}`);
  }

  // Source 6: EODHD — uses country-specific path (e.g. KE/ABSA for NSE, US/AAPL for NYSE)
  try {
    const dotIndex = symbolUpper.lastIndexOf('.');
    const hasCountrySuffix = dotIndex !== -1 && (symbolUpper.length - dotIndex - 1) <= 3;
    const eodCountry = hasCountrySuffix ? symbolUpper.substring(dotIndex + 1) : 'US';
    const eodTicker = hasCountrySuffix ? symbolUpper.substring(0, dotIndex) : symbolUpper;
    const eodhdUrl = `https://eodhistoricaldata.com/img/logos/${eodCountry}/${eodTicker}.png`;
    const response = await axios.get(eodhdUrl, {
      responseType: 'arraybuffer',
      timeout: 3000,
      validateStatus: (status) => status < 500
    });

    if (response.status === 200 && response.data.length > 500) {
      const result = {
        data: response.data,
        contentType: 'image/png',
        source: 'eodhd'
      };
      logoCache.set(symbolUpper, { data: result, timestamp: Date.now() });
      return result;
    }
  } catch (error) {
    logger.debug(`EODHD failed for ${symbol}: ${error.message}`);
  }

  // Fallback: Generate SVG placeholder with symbol initials
  const svgPlaceholder = generatePlaceholderSvg(symbolUpper);
  const result = {
    data: Buffer.from(svgPlaceholder),
    contentType: 'image/svg+xml',
    source: 'placeholder'
  };
  logoCache.set(symbolUpper, { data: result, timestamp: Date.now() });
  return result;
};

const getCompanyLogo = async (req, res) => {
  try {
    const { symbol } = req.params;

    // Allow letters, numbers, dots, and hyphens (e.g., BRK.A, BRK-B)
    if (!symbol || !/^[A-Z0-9.-]{1,10}$/i.test(symbol)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid stock symbol'
      });
    }

    const logoResult = await fetchLogoFromSources(symbol);

    // Set cache headers for browser caching
    res.set({
      'Content-Type': logoResult.contentType,
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      'Access-Control-Allow-Origin': '*',
      'X-Logo-Source': logoResult.source // Header to indicate source (for debugging)
    });

    res.send(logoResult.data);

  } catch (error) {
    logger.error('Get company logo error:', {
      message: error.message,
      symbol: req.params.symbol
    });

    // Return placeholder on any error
    const svgPlaceholder = generatePlaceholderSvg(req.params.symbol || 'XX');
    res.set({
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    res.send(Buffer.from(svgPlaceholder));
  }
};

module.exports = {
  getCompanyLogo
};
