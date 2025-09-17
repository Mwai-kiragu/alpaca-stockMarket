const axios = require('axios');
const logger = require('../utils/logger');

class EnhancedExchangeService {
  constructor() {
    this.apiKey = process.env.EXCHANGE_RATE_API_KEY;
    this.baseUrl = process.env.EXCHANGE_RATE_API_URL || 'https://v6.exchangerate-api.com/v6';
    this.fallbackUrl = 'https://api.exchangerate.host';

    // Cache for rates to avoid excessive API calls
    this.rateCache = new Map();
    this.historicalCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async getExchangeRate(fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return 1;

    const cacheKey = `${fromCurrency}_${toCurrency}`;
    const cached = this.rateCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.rate;
    }

    try {
      let rate;

      // Try primary API first
      if (this.apiKey) {
        try {
          const response = await axios.get(
            `${this.baseUrl}/${this.apiKey}/pair/${fromCurrency}/${toCurrency}`
          );

          if (response.data.result === 'success') {
            rate = response.data.conversion_rate;
          }
        } catch (primaryError) {
          logger.warn('Primary exchange rate API failed, trying fallback:', primaryError.message);
        }
      }

      // Fallback API
      if (!rate) {
        const response = await axios.get(
          `${this.fallbackUrl}/convert?from=${fromCurrency}&to=${toCurrency}&amount=1`
        );

        if (response.data.success) {
          rate = response.data.result;
        } else {
          throw new Error('Both APIs failed to provide exchange rate');
        }
      }

      // Cache the result
      this.rateCache.set(cacheKey, {
        rate,
        timestamp: Date.now()
      });

      logger.info(`Exchange rate fetched: 1 ${fromCurrency} = ${rate} ${toCurrency}`);
      return rate;

    } catch (error) {
      logger.error('Exchange rate fetch error:', error);

      // Return cached rate if available, even if expired
      if (cached) {
        logger.warn('Using expired cached exchange rate');
        return cached.rate;
      }

      // Fallback rates for KES/USD
      if ((fromCurrency === 'KES' && toCurrency === 'USD') ||
          (fromCurrency === 'USD' && toCurrency === 'KES')) {
        const fallbackRate = fromCurrency === 'KES' ? 0.0074 : 135.0; // Approximate rates
        logger.warn(`Using fallback exchange rate: 1 ${fromCurrency} = ${fallbackRate} ${toCurrency}`);
        return fallbackRate;
      }

      throw new Error('Unable to fetch exchange rate');
    }
  }

  async getHistoricalRates(fromCurrency, toCurrency, days = 30) {
    const cacheKey = `${fromCurrency}_${toCurrency}_${days}d`;
    const cached = this.historicalCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 60 * 60 * 1000) { // 1 hour cache
      return cached.data;
    }

    try {
      const historicalRates = [];
      const endDate = new Date();

      // For demonstration, we'll generate synthetic historical data
      // In production, you'd use a real historical rates API
      for (let i = days; i >= 0; i--) {
        const date = new Date(endDate.getTime() - i * 24 * 60 * 60 * 1000);
        const currentRate = await this.getExchangeRate(fromCurrency, toCurrency);

        // Add some realistic variation (±2%)
        const variation = (Math.random() - 0.5) * 0.04;
        const historicalRate = currentRate * (1 + variation);

        historicalRates.push({
          date: date.toISOString().split('T')[0],
          rate: parseFloat(historicalRate.toFixed(6)),
          timestamp: date.toISOString()
        });
      }

      // Cache the result
      this.historicalCache.set(cacheKey, {
        data: historicalRates,
        timestamp: Date.now()
      });

      return historicalRates;

    } catch (error) {
      logger.error('Historical rates fetch error:', error);

      // Return cached data if available
      if (cached) {
        logger.warn('Using cached historical rates');
        return cached.data;
      }

      return [];
    }
  }

  async convertCurrency(amount, fromCurrency, toCurrency) {
    const rate = await this.getExchangeRate(fromCurrency, toCurrency);
    const convertedAmount = amount * rate;

    return {
      originalAmount: amount,
      convertedAmount,
      rate,
      fromCurrency,
      toCurrency,
      timestamp: new Date().toISOString()
    };
  }

  calculateForexFees(amount, currency = 'USD') {
    const feeRate = parseFloat(process.env.FOREX_FEE_RATE) || 0.015; // 1.5% default
    const minFeeUsd = parseFloat(process.env.MIN_FOREX_FEE_USD) || 0.5;
    const minFeeKes = parseFloat(process.env.MIN_FOREX_FEE_KES) || 50;

    const calculatedFee = amount * feeRate;
    const minimumFee = currency === 'USD' ? minFeeUsd : minFeeKes;

    return Math.max(calculatedFee, minimumFee);
  }

  async getMultipleRates(baseCurrency, targetCurrencies) {
    try {
      const rates = {};

      if (this.apiKey) {
        const response = await axios.get(
          `${this.baseUrl}/${this.apiKey}/latest/${baseCurrency}`
        );

        if (response.data.result === 'success') {
          const conversionRates = response.data.conversion_rates;

          targetCurrencies.forEach(currency => {
            if (conversionRates[currency]) {
              rates[currency] = conversionRates[currency];
            }
          });

          return {
            baseCurrency,
            rates,
            timestamp: new Date().toISOString(),
            source: 'primary'
          };
        }
      }

      // Fallback: get rates individually
      for (const currency of targetCurrencies) {
        try {
          rates[currency] = await this.getExchangeRate(baseCurrency, currency);
        } catch (error) {
          logger.warn(`Failed to get rate for ${baseCurrency} to ${currency}:`, error.message);
        }
      }

      return {
        baseCurrency,
        rates,
        timestamp: new Date().toISOString(),
        source: 'fallback'
      };

    } catch (error) {
      logger.error('Multiple rates fetch error:', error);
      throw error;
    }
  }

  async convertKEStoUSD(amountKes) {
    const rate = await this.getExchangeRate('KES', 'USD');
    const convertedAmount = amountKes * rate;
    const fees = this.calculateForexFees(convertedAmount, 'USD');

    return {
      originalAmount: amountKes,
      rate,
      convertedAmount,
      fees,
      finalAmount: convertedAmount - fees,
      currency: 'USD'
    };
  }

  async convertUSDtoKES(amountUsd) {
    const rate = await this.getExchangeRate('USD', 'KES');
    const convertedAmount = amountUsd * rate;
    const fees = this.calculateForexFees(convertedAmount, 'KES');

    return {
      originalAmount: amountUsd,
      rate,
      convertedAmount,
      fees,
      finalAmount: convertedAmount - fees,
      currency: 'KES'
    };
  }

  async getCurrencyInfo() {
    return {
      supportedCurrencies: ['KES', 'USD'],
      baseCurrency: 'USD',
      fees: {
        forexFeeRate: parseFloat(process.env.FOREX_FEE_RATE) || 0.015,
        minimumFees: {
          USD: parseFloat(process.env.MIN_FOREX_FEE_USD) || 0.5,
          KES: parseFloat(process.env.MIN_FOREX_FEE_KES) || 50
        }
      },
      limits: {
        minConversionUSD: 1,
        minConversionKES: 100,
        maxConversionUSD: 10000,
        maxConversionKES: 1500000,
        dailyLimitUSD: 50000,
        dailyLimitKES: 7500000
      },
      features: {
        realTimeRates: true,
        historicalData: true,
        bulkConversions: true,
        rateAlerts: true
      }
    };
  }

  async getRateAlerts(targetRate, fromCurrency, toCurrency, condition = 'above') {
    const currentRate = await this.getExchangeRate(fromCurrency, toCurrency);

    const isTriggered = condition === 'above' ?
      currentRate >= targetRate :
      currentRate <= targetRate;

    return {
      currentRate,
      targetRate,
      condition,
      isTriggered,
      difference: currentRate - targetRate,
      differencePercent: ((currentRate - targetRate) / targetRate) * 100,
      fromCurrency,
      toCurrency,
      timestamp: new Date().toISOString()
    };
  }

  clearCache() {
    this.rateCache.clear();
    this.historicalCache.clear();
    logger.info('Exchange rate cache cleared');
  }

  getCacheStats() {
    return {
      rateCacheSize: this.rateCache.size,
      historicalCacheSize: this.historicalCache.size,
      cacheTimeout: this.cacheTimeout,
      lastCleared: new Date().toISOString()
    };
  }
}

module.exports = new EnhancedExchangeService();