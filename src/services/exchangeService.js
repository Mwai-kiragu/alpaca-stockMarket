const axios = require('axios');
const logger = require('../utils/logger');

class ExchangeService {
  constructor() {
    this.apiKey = process.env.EXCHANGE_RATE_API_KEY;
    this.baseUrl = 'https://v6.exchangerate-api.com/v6';
    this.fallbackRate = 140;
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000;
  }

  async getExchangeRate(from = 'KES', to = 'USD') {
    try {
      const cacheKey = `${from}_${to}`;
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
        return cached.rate;
      }

      const response = await axios.get(`${this.baseUrl}/${this.apiKey}/pair/${from}/${to}`, {
        timeout: 5000
      });

      const rate = response.data.conversion_rate;

      this.cache.set(cacheKey, {
        rate,
        timestamp: Date.now()
      });

      logger.info(`Exchange rate fetched: ${from}/${to} = ${rate}`);
      return rate;
    } catch (error) {
      logger.error('Exchange rate fetch error:', error.message);

      const cached = this.cache.get(`${from}_${to}`);
      if (cached) {
        logger.warn('Using cached exchange rate due to API error');
        return cached.rate;
      }

      logger.warn('Using fallback exchange rate');
      return from === 'KES' && to === 'USD' ? 1 / this.fallbackRate : this.fallbackRate;
    }
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
      nextClose: this.getNextMarketClose()
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