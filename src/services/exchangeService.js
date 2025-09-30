const axios = require('axios');
const logger = require('../utils/logger');

class ExchangeService {
  constructor() {
    this.apiKey = process.env.EXCHANGE_RATE_API_KEY;
    this.cache = new Map();
    this.cacheExpiry = 2 * 60 * 1000; // 2 minutes cache for real-time rates

    // Multiple exchange rate providers for reliability
    this.providers = [
      {
        name: 'exchangerate-api',
        url: 'https://v6.exchangerate-api.com/v6',
        key: this.apiKey,
        free: !this.apiKey
      },
      {
        name: 'fixer',
        url: 'https://api.fixer.io/latest',
        key: process.env.FIXER_API_KEY,
        free: !process.env.FIXER_API_KEY
      },
      {
        name: 'currencyapi',
        url: 'https://api.currencyapi.com/v3/latest',
        key: process.env.CURRENCY_API_KEY,
        free: !process.env.CURRENCY_API_KEY
      },
      {
        name: 'freecurrency', // Always free
        url: 'https://api.freecurrencyapi.com/v1/latest',
        key: process.env.FREE_CURRENCY_API_KEY,
        free: true
      }
    ];

    // Current USD/KES approximate rate for fallback (updated with real market rates)
    this.fallbackRates = {
      'USD_KES': 129.24, // 1 USD = 129.24 KES (real rate as of Sept 29, 2025)
      'KES_USD': 1 / 129.24, // 1 KES = ~0.0077 USD
      'EUR_KES': 139.20, // 1 EUR = ~139.20 KES
      'GBP_KES': 173.25, // 1 GBP = ~173.25 KES
    };
  }

  async getExchangeRate(from = 'KES', to = 'USD') {
    try {
      const cacheKey = `${from}_${to}`;
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
        logger.info(`Using cached exchange rate: ${from}/${to} = ${cached.rate}`);
        return cached.rate;
      }

      // Try multiple providers for real-time rates
      const rate = await this.fetchFromMultipleProviders(from, to);

      if (rate) {
        this.cache.set(cacheKey, {
          rate,
          timestamp: Date.now()
        });

        logger.info(`Live exchange rate fetched: ${from}/${to} = ${rate}`);
        return rate;
      }

      throw new Error('All providers failed');

    } catch (error) {
      logger.error('Exchange rate fetch error:', error.message);

      // Try cached rate first
      const cached = this.cache.get(`${from}_${to}`);
      if (cached) {
        logger.warn(`Using cached exchange rate due to API error: ${cached.rate}`);
        return cached.rate;
      }

      // Use realistic fallback rate
      const fallbackKey = `${from}_${to}`;
      const fallbackRate = this.fallbackRates[fallbackKey];

      if (fallbackRate) {
        logger.warn(`Using fallback exchange rate: ${from}/${to} = ${fallbackRate}`);
        return fallbackRate;
      }

      // Last resort calculation
      logger.warn('Using calculated fallback exchange rate');
      return from === 'KES' && to === 'USD' ? this.fallbackRates.KES_USD : this.fallbackRates.USD_KES;
    }
  }

  async fetchFromMultipleProviders(from, to) {
    for (const provider of this.providers) {
      try {
        const rate = await this.fetchFromProvider(provider, from, to);
        if (rate) {
          logger.info(`Rate fetched successfully from ${provider.name}: ${rate}`);
          return rate;
        }
      } catch (error) {
        logger.warn(`Provider ${provider.name} failed:`, error.message);
        continue;
      }
    }

    // Try free external APIs as final fallback
    return await this.fetchFromFreeAPIs(from, to);
  }

  async fetchFromProvider(provider, from, to) {
    const timeout = 8000; // 8 second timeout

    switch (provider.name) {
      case 'exchangerate-api':
        if (provider.key) {
          const response = await axios.get(`${provider.url}/${provider.key}/pair/${from}/${to}`, { timeout });
          return response.data.conversion_rate;
        } else {
          // Free version
          const response = await axios.get(`${provider.url}/latest/${from}`, { timeout });
          return response.data.conversion_rates[to];
        }

      case 'fixer':
        if (provider.key) {
          const response = await axios.get(`${provider.url}?access_key=${provider.key}&base=${from}&symbols=${to}`, { timeout });
          return response.data.rates[to];
        }
        break;

      case 'currencyapi':
        if (provider.key) {
          const response = await axios.get(`${provider.url}?apikey=${provider.key}&base_currency=${from}&currencies=${to}`, { timeout });
          return response.data.data[to].value;
        }
        break;

      case 'freecurrency':
        if (provider.key) {
          const response = await axios.get(`${provider.url}?apikey=${provider.key}&base_currency=${from}&currencies=${to}`, { timeout });
          return response.data.data[to];
        }
        break;
    }

    return null;
  }

  async fetchFromFreeAPIs(from, to) {
    const freeApis = [
      // Free exchange rates API
      {
        url: `https://api.exchangerate-api.com/v4/latest/${from}`,
        parser: (data) => data.rates[to]
      },
      // Free currency rates API
      {
        url: `https://api.currencybeacon.com/v1/latest?base=${from}&symbols=${to}`,
        parser: (data) => data.rates[to]
      }
    ];

    for (const api of freeApis) {
      try {
        const response = await axios.get(api.url, { timeout: 5000 });
        const rate = api.parser(response.data);
        if (rate && !isNaN(rate)) {
          logger.info(`Free API rate fetched: ${from}/${to} = ${rate}`);
          return rate;
        }
      } catch (error) {
        logger.warn(`Free API failed: ${error.message}`);
        continue;
      }
    }

    return null;
  }

  async convertCurrency(amount, from = 'KES', to = 'USD') {
    try {
      const rate = await this.getExchangeRate(from, to);
      const convertedAmount = amount * rate;

      return {
        originalAmount: amount,
        convertedAmount: Math.round(convertedAmount * 100) / 100,
        rate,
        fromCurrency: from,
        toCurrency: to
      };
    } catch (error) {
      logger.error('Currency conversion error:', error);
      throw new Error('Failed to convert currency');
    }
  }

  calculateForexFees(amount, rate = 0.015) {
    return Math.round(amount * rate * 100) / 100;
  }

  async convertKEStoUSD(kesAmount) {
    const conversion = await this.convertCurrency(kesAmount, 'KES', 'USD');
    const forexFees = this.calculateForexFees(conversion.convertedAmount);

    return {
      ...conversion,
      forexFees,
      finalAmount: conversion.convertedAmount - forexFees
    };
  }

  async convertUSDtoKES(usdAmount) {
    const conversion = await this.convertCurrency(usdAmount, 'USD', 'KES');
    const forexFees = this.calculateForexFees(conversion.convertedAmount);

    return {
      ...conversion,
      forexFees,
      finalAmount: conversion.convertedAmount - forexFees
    };
  }

  // Get real-time exchange rates for multiple currency pairs
  async getCurrentRates() {
    try {
      const pairs = [
        { from: 'USD', to: 'KES' },
        { from: 'KES', to: 'USD' },
        { from: 'EUR', to: 'KES' },
        { from: 'GBP', to: 'KES' }
      ];

      const rates = {};
      const promises = pairs.map(async ({ from, to }) => {
        try {
          const rate = await this.getExchangeRate(from, to);
          rates[`${from}_${to}`] = {
            rate,
            pair: `${from}/${to}`,
            lastUpdated: new Date().toISOString()
          };
        } catch (error) {
          logger.error(`Failed to fetch ${from}/${to} rate:`, error.message);
          rates[`${from}_${to}`] = {
            error: 'Failed to fetch rate',
            pair: `${from}/${to}`,
            lastUpdated: new Date().toISOString()
          };
        }
      });

      await Promise.allSettled(promises);

      return {
        success: true,
        rates,
        timestamp: new Date().toISOString(),
        cacheExpiry: this.cacheExpiry / 1000 // in seconds
      };
    } catch (error) {
      logger.error('Get current rates error:', error);
      return {
        success: false,
        error: 'Failed to fetch exchange rates',
        timestamp: new Date().toISOString()
      };
    }
  }

  getMarketStatus() {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const currentTime = utcHours * 60 + utcMinutes;

    const marketOpen = 14 * 60 + 30;
    const marketClose = 21 * 60;

    const isWeekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;

    return {
      isOpen: isWeekday && currentTime >= marketOpen && currentTime < marketClose,
      nextOpen: this.getNextMarketOpen(),
      nextClose: this.getNextMarketClose(),
      timezone: 'UTC'
    };
  }

  getNextMarketOpen() {
    const now = new Date();
    const nextOpen = new Date(now);

    if (now.getUTCDay() === 0) {
      nextOpen.setUTCDate(now.getUTCDate() + 1);
    } else if (now.getUTCDay() === 6) {
      nextOpen.setUTCDate(now.getUTCDate() + 2);
    } else if (now.getUTCHours() >= 21) {
      nextOpen.setUTCDate(now.getUTCDate() + 1);
    }

    nextOpen.setUTCHours(14, 30, 0, 0);
    return nextOpen;
  }

  getNextMarketClose() {
    const now = new Date();
    const nextClose = new Date(now);

    if (now.getUTCDay() === 6 || now.getUTCDay() === 0) {
      nextClose.setUTCDate(now.getUTCDate() + (1 - now.getUTCDay() + 7) % 7);
    }

    nextClose.setUTCHours(21, 0, 0, 0);
    return nextClose;
  }
}

module.exports = new ExchangeService();