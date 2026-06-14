const request = require('supertest');
const app = require('../src/server');

// Prevent real calls to Alpha Vantage, Yahoo Finance, FMP from slow tests down
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    get: jest.fn((url) => {
      // Financial data endpoints → return empty so fallback chain short-circuits
      if (
        url.includes('alphavantage.co') ||
        url.includes('query2.finance.yahoo.com') ||
        url.includes('financialmodelingprep.com') ||
        url.includes('tradingview.com') ||
        url.includes('logo.dev') ||
        url.includes('mystocks.africa/logos')
      ) {
        return Promise.resolve({ status: 200, data: {}, headers: { 'content-type': 'image/svg+xml' } });
      }
      return actual.get(url);
    }),
    create: actual.create,
    defaults: actual.defaults,
    interceptors: actual.interceptors,
  };
});

jest.mock('../src/services/alpacaService', () => ({
  getAssets: jest.fn(),
  getAsset: jest.fn(),
  getLatestQuote: jest.fn(),
  getBars: jest.fn(),
  createOrder: jest.fn(),
  getOrders: jest.fn(),
  getOrder: jest.fn(),
  cancelOrder: jest.fn(),
  getMostActiveStocks: jest.fn(),
  getTopMovers: jest.fn(),
  searchAssets: jest.fn(),
  getCompanyLogo: jest.fn((sym) => `https://logo/${sym}`),
  getMarketStatus: jest.fn(),
  getNews: jest.fn().mockResolvedValue([]),
  getPositions: jest.fn(),
  getAccount: jest.fn(),
}));
jest.mock('../src/services/mystocksService', () => ({
  getStocks: jest.fn(),
  getStockBySlug: jest.fn(),
  getStockPulse: jest.fn(),
  buildStockSlug: jest.fn((name, exchange) => `${name.toLowerCase().replace(/\s+/g, '-')}-${exchange.toLowerCase()}`),
  getWallet: jest.fn(),
  placeTrade: jest.fn(),
  getOrders: jest.fn(),
  createSubAccount: jest.fn(),
  getSubAccount: jest.fn(),
}));
jest.mock('../src/services/exchangeService', () => ({
  getExchangeRate: jest.fn().mockResolvedValue(129.26),
  convertCurrency: jest.fn().mockResolvedValue({ convertedAmount: 129.26, rate: 129.26 }),
  getCurrentRates: jest.fn().mockResolvedValue({ rates: { USD_KES: 129.26 } }),
}));
jest.mock('../src/config/redis', () => {
  const mockQuit = jest.fn().mockResolvedValue(undefined);
  const mockClient = { quit: mockQuit, subscribe: jest.fn(), on: jest.fn(), disconnect: jest.fn() };
  const mockPub = { quit: mockQuit, on: jest.fn() };
  const mockSub = { quit: mockQuit, subscribe: jest.fn().mockResolvedValue(undefined), psubscribe: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
  return {
    initialize: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    client: mockClient,
    publisher: mockPub,
    subscriber: mockSub,
    getClient: jest.fn().mockReturnValue(mockClient),
    getPublisher: jest.fn().mockReturnValue(mockPub),
    getSubscriber: jest.fn().mockReturnValue(mockSub),
    isConnected: false,
  };
});
jest.mock('../src/middleware/auth', () => ({
  auth: (req, _res, next) => {
    req.user = { id: 'test-user-id', email: 'test@example.com', account_mode: 'demo', demo_balance: 10000 };
    next();
  },
  requireKYCOrMyStocks: (_req, _res, next) => next(),
  requireKYC: (_req, _res, next) => next(),
  authorize: () => (_req, _res, next) => next(),
  requireBiometric: (_req, _res, next) => next(),
  requirePin: (_req, _res, next) => next(),
  adminAuth: (_req, _res, next) => next(),
  checkAccountStatus: (_req, _res, next) => next(),
}));
jest.mock('../src/middleware/checkAccountStatus', () => ({
  checkAccountStatus: (_req, _res, next) => next(),
}));

jest.mock('../src/models/Watchlist', () => ({
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../src/models/Order', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  findByPk: jest.fn(),
  create: jest.fn(),
  sequelize: { Sequelize: { Op: { notIn: Symbol('notIn'), between: Symbol('between') } } },
}));
jest.mock('../src/models/MsOrder', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../src/models/DemoOrder', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../src/models', () => ({
  User: {
    findByPk: jest.fn().mockResolvedValue({
      id: 'test-user-id',
      alpaca_account_id: 'alp-123',
      mystocks_sub_account_id: null,
      account_mode: 'demo',
      demo_balance: 10000,
    }),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  Order: require('../src/models/Order'),
  DemoOrder: require('../src/models/DemoOrder'),
  MsOrder: require('../src/models/MsOrder'),
  Wallet: { findOne: jest.fn(), create: jest.fn() },
  Transaction: { findAll: jest.fn().mockResolvedValue([]), create: jest.fn() },
  Watchlist: require('../src/models/Watchlist'),
  sequelize: { Sequelize: { Op: { ne: Symbol('ne'), gte: Symbol('gte'), or: Symbol('or'), notIn: Symbol('notIn'), between: Symbol('between') } } },
}));

const alpacaService = require('../src/services/alpacaService');
const ms = require('../src/services/mystocksService');
const MsOrder = require('../src/models/MsOrder');
const DemoOrder = require('../src/models/DemoOrder');

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/stocks/company/AAPL (US stock)', () => {
  it('returns 200 with company object including yourPosition null when no orders', async () => {
    alpacaService.getAsset.mockResolvedValue({
      symbol: 'AAPL',
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
      class: 'us_equity',
      status: 'active',
      tradable: true,
      marginable: true,
      shortable: true,
      easy_to_borrow: true,
      fractionable: true,
    });
    alpacaService.getLatestQuote.mockResolvedValue({ ap: 178.5, bp: 178.4, t: new Date().toISOString() });
    alpacaService.getBars.mockResolvedValue([
      { t: '2025-01-01', o: 170, h: 180, l: 169, c: 175, v: 1000000 },
      { t: '2025-01-02', o: 175, h: 182, l: 174, c: 178.5, v: 900000 },
    ]);
    alpacaService.getPositions.mockResolvedValue([]);
    MsOrder.findAll.mockResolvedValue([]);
    DemoOrder.findAll.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/company/AAPL')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('company');
    expect(res.body.company.symbol).toBe('AAPL');
    // No orders → yourPosition should be null
    expect(res.body.yourPosition).toBeUndefined();
  });
});

describe('GET /api/v1/stocks/company/ABSA.KE', () => {
  const mockAbsaStock = {
    symbol: 'ABSA.KE',
    name: 'Absa Bank Kenya',
    exchange: 'NSE',
    price: 14.5,
    previousClose: 14.2,
    currency: 'KES',
    usdPrice: 0.112,
    sector: 'Financial Services',
  };

  it('returns 200 with assetClass=african_equity', async () => {
    ms.getStocks.mockResolvedValue([mockAbsaStock]);
    ms.buildStockSlug.mockReturnValue('absa-bank-kenya-nse');
    ms.getStockBySlug.mockResolvedValue({
      description: 'Absa Bank Kenya Limited.',
      sector: 'Financial Services',
      logo: { imageUrl: 'https://cdn.example.com/absa.png' },
    });
    ms.getStockPulse.mockResolvedValue({ pulse: 'positive' });
    MsOrder.findAll.mockResolvedValue([]);
    DemoOrder.findAll.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/company/ABSA.KE')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.company.assetClass).toBe('african_equity');
    expect(res.body.company.symbol).toBe('ABSA.KE');
  });

  it('returns 200 with warning field when ms.getStocks throws timeout error', async () => {
    const timeoutError = new Error('timeout of 5000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    ms.getStocks.mockRejectedValue(timeoutError);
    MsOrder.findAll.mockResolvedValue([]);
    DemoOrder.findAll.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/company/ABSA.KE')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('warning');
  });
});

describe('GET /api/v1/stocks/company/INVALID', () => {
  it('returns 404 when alpaca returns 404', async () => {
    const notFoundError = new Error('asset not found — 404');
    alpacaService.getAsset.mockRejectedValue(notFoundError);

    const res = await request(app)
      .get('/api/v1/stocks/company/INVALID')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
