const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Symbol to domain mapping for major stocks
 * Used to fetch logos from Clearbit since Alpaca logos require paid subscription
 */
const symbolToDomain = {
  'AAPL': 'apple.com',
  'GOOGL': 'google.com',
  'GOOG': 'google.com',
  'MSFT': 'microsoft.com',
  'AMZN': 'amazon.com',
  'TSLA': 'tesla.com',
  'META': 'meta.com',
  'NVDA': 'nvidia.com',
  'NFLX': 'netflix.com',
  'V': 'visa.com',
  'JPM': 'jpmorgan.com',
  'WMT': 'walmart.com',
  'DIS': 'disney.com',
  'PYPL': 'paypal.com',
  'INTC': 'intel.com',
  'CMCSA': 'comcast.com',
  'PFE': 'pfizer.com',
  'KO': 'coca-cola.com',
  'NKE': 'nike.com',
  'ORCL': 'oracle.com',
  'ADBE': 'adobe.com',
  'CRM': 'salesforce.com',
  'T': 'att.com',
  'VZ': 'verizon.com',
  'IBM': 'ibm.com',
  'BA': 'boeing.com',
  'GE': 'ge.com',
  'AMD': 'amd.com',
  'UBER': 'uber.com',
  'SHOP': 'shopify.com',
  'SPOT': 'spotify.com',
  'SNAP': 'snap.com',
  'TWTR': 'twitter.com',
  'SQ': 'squareup.com',
  'ROKU': 'roku.com',
  'ZM': 'zoom.us',
  'DDOG': 'datadoghq.com',
  'SNOW': 'snowflake.com',
  'CRWD': 'crowdstrike.com'
};

/**
 * Proxy endpoint to fetch company logos
 * Uses Clearbit as primary source (free, no auth required)
 * Falls back to generic placeholder if logo not found
 */
const getCompanyLogo = async (req, res) => {
  try {
    const { symbol } = req.params;

    if (!symbol || !/^[A-Z]{1,5}$/i.test(symbol)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid stock symbol'
      });
    }

    const symbolUpper = symbol.toUpperCase();

    // Get domain for the symbol
    const domain = symbolToDomain[symbolUpper];

    if (!domain) {
      // Return 404 if we don't have a domain mapping
      logger.warn(`No domain mapping for symbol: ${symbolUpper}`);
      return res.status(404).json({
        success: false,
        message: 'Logo not available for this symbol'
      });
    }

    // Fetch logo from Clearbit (free service, no auth required)
    const clearbitUrl = `https://logo.clearbit.com/${domain}`;

    const response = await axios.get(clearbitUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
      validateStatus: (status) => status < 500 // Don't throw on 404
    });

    if (response.status === 404) {
      return res.status(404).json({
        success: false,
        message: 'Logo not found'
      });
    }

    // Get content type from response
    const contentType = response.headers['content-type'] || 'image/png';

    // Set cache headers for browser caching (logos don't change often)
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=2592000', // Cache for 30 days
      'Access-Control-Allow-Origin': '*' // Allow CORS
    });

    // Send the image
    res.send(response.data);

  } catch (error) {
    logger.error('Get company logo error:', {
      message: error.message,
      status: error.response?.status,
      symbol: req.params.symbol
    });

    res.status(404).json({
      success: false,
      message: 'Logo not found'
    });
  }
};

module.exports = {
  getCompanyLogo
};
