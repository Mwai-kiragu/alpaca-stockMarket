const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const BASE_URL = process.env.MYSTOCKS_ENV === 'production'
  ? 'https://mystocks.africa/api/v1/partner'
  : 'https://mystocks.africa/api/sandbox/v1';

// Public web API — no partner key needed, used for stock detail + chart history
const publicClient = axios.create({
  baseURL: 'https://mystocks.africa/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000
});

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${process.env.MYSTOCKS_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 15000
});

client.interceptors.response.use(
  res => res,
  err => {
    const status = err.response?.status;
    const message = err.response?.data?.message || err.message;
    logger.error(`MyStocks API error [${status}]: ${message}`, {
      url: err.config?.url,
      method: err.config?.method
    });
    return Promise.reject(err);
  }
);

const idempotencyKey = () => uuidv4();

const createSubAccount = async ({ externalId, displayName, email }) => {
  const res = await client.post('/users', { externalId, displayName, email });
  return res.data;
};

const getSubAccount = async (subAccountId) => {
  const res = await client.get(`/users/${subAccountId}`);
  return res.data;
};

const getSubAccountByExternalId = async (externalId) => {
  const res = await client.get('/users', { params: { externalId } });
  return res.data;
};

const updateSubAccount = async (subAccountId, updates) => {
  const res = await client.patch(`/users/${subAccountId}`, updates);
  return res.data;
};

const updateKYC = async (subAccountId, { status, level, reference }) => {
  const res = await client.post(`/users/${subAccountId}/kyc`, { status, level, reference });
  return res.data;
};

const getWallet = async (subAccountId) => {
  const res = await client.get(`/users/${subAccountId}/wallet`);
  return res.data;
};

const depositToSubAccount = async (subAccountId, { amount, currency, localAmount, localCurrency, fxRate, reference }) => {
  const res = await client.post(
    `/users/${subAccountId}/deposit`,
    { amount, currency, localAmount, localCurrency, fxRate, reference },
    { headers: { 'Idempotency-Key': idempotencyKey() } }
  );
  return res.data;
};

const withdrawFromSubAccount = async (subAccountId, { amount, currency, reference }) => {
  const res = await client.post(
    `/users/${subAccountId}/withdraw`,
    { amount, currency, reference },
    { headers: { 'Idempotency-Key': idempotencyKey() } }
  );
  return res.data;
};

const getTransactions = async (subAccountId, { page, limit } = {}) => {
  const res = await client.get(`/users/${subAccountId}/transactions`, { params: { page, limit } });
  return res.data;
};

const placeTrade = async (subAccountId, { symbol, type, quantity }) => {
  const res = await client.post(
    `/users/${subAccountId}/trade`,
    { symbol, type, quantity },
    { headers: { 'Idempotency-Key': idempotencyKey() } }
  );
  return res.data;
};

const getOrders = async (subAccountId, { symbol, status, page, limit } = {}) => {
  const res = await client.get(`/users/${subAccountId}/orders`, {
    params: { symbol, status, page, limit }
  });
  return res.data;
};

const getPortfolio = async (subAccountId) => {
  const res = await client.get(`/users/${subAccountId}/portfolio`);
  return res.data;
};

const getStocks = async ({ exchange, sector, search, page, limit } = {}) => {
  const res = await client.get('/stocks', { params: { exchange, sector, search, page, limit } });
  return res.data;
};

const getStockHistory = async (symbol, range = '1M') => {
  const res = await client.get(`/stocks/${symbol}/history`, { params: { range } });
  if (typeof res.data === 'string' && res.data.trimStart().startsWith('<')) {
    throw new Error(`MyStocks history endpoint not available for ${symbol} (sandbox may not support this endpoint)`);
  }
  return res.data;
};

// Build the slug MyStocks web app uses: e.g. "Absa Bank Kenya PLC" + "NSE" → "absa-bank-kenya-plc-nse"
const buildStockSlug = (name, exchange) =>
  `${name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-')}-${exchange.toLowerCase()}`;

// Public API — returns stock detail including price history used by the web chart
const getStockBySlug = async (slug, range = '1M') => {
  const res = await publicClient.get(`/stocks/${slug}`, { params: { t: Date.now() } });
  if (typeof res.data === 'string' && res.data.trimStart().startsWith('<')) {
    throw new Error(`MyStocks public stock endpoint not available for slug: ${slug}`);
  }
  return res.data;
};

const getStockPulse = async (symbol) => {
  const res = await client.get(`/stocks/${symbol}/pulse`);
  return res.data;
};

const getBonds = async ({ type, currency, exchange } = {}) => {
  const res = await client.get('/bonds', { params: { type, currency, exchange } });
  return res.data;
};

const getBond = async (bondId) => {
  const res = await client.get(`/bonds/${bondId}`);
  return res.data;
};

const subscribeToBond = async (subAccountId, { bondId, units }) => {
  const res = await client.post(
    `/users/${subAccountId}/subscribe`,
    { bondId, units },
    { headers: { 'Idempotency-Key': idempotencyKey() } }
  );
  return res.data;
};

const getFunds = async ({ category, currency } = {}) => {
  const res = await client.get('/funds', { params: { category, currency } });
  return res.data;
};

const getFund = async (fundId) => {
  const res = await client.get(`/funds/${fundId}`);
  return res.data;
};

const subscribeToFund = async (subAccountId, { fundId, units }) => {
  const res = await client.post(
    `/users/${subAccountId}/subscribe`,
    { fundId, units },
    { headers: { 'Idempotency-Key': idempotencyKey() } }
  );
  return res.data;
};

const redeemFund = async (subAccountId, { holdingId, units }) => {
  const res = await client.post(
    `/users/${subAccountId}/redeem`,
    { holdingId, units },
    { headers: { 'Idempotency-Key': idempotencyKey() } }
  );
  return res.data;
};

const getMarketIntel = async ({ symbol, exchange, page, limit } = {}) => {
  const res = await client.get('/market-intel', { params: { symbol, exchange, page, limit } });
  return res.data;
};

const getMarketIntelArticle = async (idOrSlug) => {
  const res = await client.get(`/market-intel/${idOrSlug}`);
  return res.data;
};

const getDividendCalendar = async ({ status } = {}) => {
  const params = {};
  if (status) params.status = status.toUpperCase();
  const res = await client.get('/dividends/calendar', { params });
  return res.data;
};

const getUserDividends = async (subAccountId) => {
  const res = await client.get(`/users/${subAccountId}/dividends`);
  return res.data;
};

const getAUM = async () => {
  const res = await client.get('/report/aum');
  return res.data;
};

const getAggregatedPositions = async () => {
  const res = await client.get('/report/positions');
  return res.data;
};

const registerWebhook = async ({ url, events, secret }) => {
  const res = await client.post('/webhooks', { url, events, secret });
  return res.data;
};

module.exports = {
  createSubAccount,
  getSubAccount,
  getSubAccountByExternalId,
  updateSubAccount,
  updateKYC,
  getWallet,
  depositToSubAccount,
  withdrawFromSubAccount,
  getTransactions,
  placeTrade,
  getOrders,
  getPortfolio,
  getStocks,
  getStockHistory,
  buildStockSlug,
  getStockBySlug,
  getStockPulse,
  getBonds,
  getBond,
  subscribeToBond,
  getFunds,
  getFund,
  subscribeToFund,
  redeemFund,
  getMarketIntel,
  getMarketIntelArticle,
  getDividendCalendar,
  getUserDividends,
  getAUM,
  getAggregatedPositions,
  registerWebhook
};
