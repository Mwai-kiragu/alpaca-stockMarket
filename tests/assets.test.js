const request = require('supertest');
const app = require('../src/server');

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
  getNews: jest.fn(),
}));
jest.mock('../src/services/mystocksService', () => ({
  getStocks: jest.fn(),
  getStockBySlug: jest.fn(),
  getStockPulse: jest.fn(),
  buildStockSlug: jest.fn(),
  getWallet: jest.fn(),
  placeTrade: jest.fn(),
  getOrders: jest.fn(),
  createSubAccount: jest.fn(),
  getSubAccount: jest.fn(),
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
jest.mock('../src/models', () => ({
  User: { findByPk: jest.fn(), findOne: jest.fn(), create: jest.fn() },
  Order: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn() },
  DemoOrder: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn() },
  MsOrder: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn() },
  Wallet: { findOne: jest.fn(), create: jest.fn() },
  Transaction: { findAll: jest.fn().mockResolvedValue([]), create: jest.fn() },
  Watchlist: require('../src/models/Watchlist'),
  sequelize: { Sequelize: { Op: { ne: Symbol('ne'), gte: Symbol('gte'), or: Symbol('or'), notIn: Symbol('notIn'), between: Symbol('between') } } },
}));

jest.mock('axios', () => {
  const mockBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  return {
    get: jest.fn().mockResolvedValue({
      status: 200,
      data: mockBuffer,
      headers: { 'content-type': 'image/svg+xml' },
    }),
  };
});

const alpacaService = require('../src/services/alpacaService');
const ms = require('../src/services/mystocksService');

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/assets/categories', () => {
  it('returns 200 with categories array', async () => {
    const res = await request(app).get('/api/v1/assets/categories');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('grouped');
  });
});

describe('GET /api/v1/assets/?asset_class=NSE', () => {
  it('returns 200 with mystocks provider', async () => {
    ms.getStocks.mockResolvedValue([
      { symbol: 'ABSA.KE', name: 'Absa Bank Kenya', exchange: 'NSE', price: 14.5, currency: 'KES' },
      { symbol: 'EQTY.KE', name: 'Equity Group', exchange: 'NSE', price: 52.0, currency: 'KES' },
    ]);

    const res = await request(app)
      .get('/api/v1/assets/?asset_class=NSE')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('mystocks');
    expect(Array.isArray(res.body.assets)).toBe(true);
  });

  it('returns 200 with empty assets array and warning when ms.getStocks throws 503', async () => {
    const serviceError = new Error('Service Unavailable');
    serviceError.response = { status: 503 };
    ms.getStocks.mockRejectedValue(serviceError);

    const res = await request(app)
      .get('/api/v1/assets/?asset_class=NSE')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.assets)).toBe(true);
    expect(res.body.assets).toHaveLength(0);
    expect(res.body).toHaveProperty('warning');
  });
});

describe('GET /api/v1/assets/?asset_class=us_equity', () => {
  it('returns 200 with alpaca provider', async () => {
    alpacaService.getAssets.mockResolvedValue([
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', tradable: true, status: 'active', class: 'us_equity', marginable: true, shortable: true, easy_to_borrow: true, fractionable: true },
      { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ', tradable: true, status: 'active', class: 'us_equity', marginable: true, shortable: true, easy_to_borrow: true, fractionable: true },
    ]);
    alpacaService.getLatestQuote.mockResolvedValue({ ap: 178.5, bp: 178.4, t: new Date().toISOString() });
    alpacaService.getBars.mockResolvedValue([
      { t: '2025-01-01', o: 170, h: 180, l: 169, c: 177, v: 1000000 },
      { t: '2025-01-02', o: 177, h: 182, l: 175, c: 178.5, v: 900000 },
    ]);

    const res = await request(app)
      .get('/api/v1/assets/?asset_class=us_equity')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.assets)).toBe(true);
  });
});

describe('GET /api/v1/assets/logo/:symbol', () => {
  it('returns 200 and image buffer for AAPL (US stock)', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValue({
      status: 200,
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
      headers: { 'content-type': 'image/svg+xml' },
    });

    const res = await request(app).get('/api/v1/assets/logo/AAPL');
    expect(res.status).toBe(200);
  });

  it('returns 200 and image buffer for EVRD.KE (African stock via MyStocks CDN)', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValue({
      status: 200,
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>'),
      headers: { 'content-type': 'image/svg+xml' },
    });

    const res = await request(app).get('/api/v1/assets/logo/EVRD.KE');
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid symbol with special characters', async () => {
    const res = await request(app).get('/api/v1/assets/logo/INVALID!!');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
