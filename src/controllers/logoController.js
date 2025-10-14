const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Proxy endpoint to fetch company logos from Alpaca
 * This is needed because Alpaca's logo endpoint requires authentication
 * which browsers can't send with <img> tags
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

    // Fetch logo from Alpaca with authentication
    const response = await axios.get(
      `https://data.alpaca.markets/v1beta1/logos/${symbolUpper}`,
      {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_PAPER_API_KEY,
          'APCA-API-SECRET-KEY': process.env.ALPACA_PAPER_SECRET_KEY
        },
        responseType: 'arraybuffer', // Get image as binary
        timeout: 5000 // 5 second timeout
      }
    );

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
    // Log detailed error information for debugging
    logger.error('Get company logo error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      symbol: req.params.symbol,
      apiKey: process.env.ALPACA_PAPER_API_KEY ? 'SET' : 'NOT SET',
      secretKey: process.env.ALPACA_PAPER_SECRET_KEY ? 'SET' : 'NOT SET'
    });

    // If logo not found or any error, return 404
    if (error.response?.status === 404 || error.response?.status === 401) {
      logger.warn(`Logo not found for symbol: ${req.params.symbol}`);
      return res.status(404).json({
        success: false,
        message: 'Logo not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch company logo'
    });
  }
};

module.exports = {
  getCompanyLogo
};
