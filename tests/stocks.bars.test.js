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
  getPositions: jest.fn(),
  getAccount: jest.fn(),
}));
jest.mock('../src/services/mystocksService', () => ({
  getStocks: jest.fn(),
  getStockBySlug: jest.fn(),
  getStockPulse: jest.fn(),
  buildStockSlug: jest.fn((name, exchange) => `${name.toLowerCase().replace(/\s+/g, '-')}-${exchange.toLowerCase()}`),
  getStockHistory: jest.fn(),
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
jest.mock('../src/models/Order', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  findByPk: jest.fn(),
  create: jest.fn(),
  sequelize: { Sequelize: { Op: { notIn: Symbol('notIn'), between: Symbol('between') } } },
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
  Watchlist: { findOne: jest.fn().mockResolvedValue(null) },
  sequelize: { Sequelize: { Op: { ne: Symbol('ne'), gte: Symbol('gte'), or: Symbol('or'), notIn: Symbol('notIn'), between: Symbol('between') } } },
}));

const alpacaService = require('../src/services/alpacaService');
const ms = require('../src/services/mystocksService');

const MOCK_BARS = [
  { t: '2025-01-01T00:00:00Z', o: 170, h: 180, l: 169, c: 175, v: 1000000, vw: 174.5, n: 5000 },
  { t: '2025-01-02T00:00:00Z', o: 175, h: 182, l: 174, c: 178.5, v: 900000, vw: 178.0, n: 4500 },
  { t: '2025-01-03T00:00:00Z', o: 178.5, h: 185, l: 177, c: 183.0, v: 950000, vw: 182.0, n: 4800 },
];

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/stocks/bars/AAPL', () => {
  it('returns 200 with bars array for AAPL', async () => {
    alpacaService.getBars.mockResolvedValue(MOCK_BARS);
    alpacaService.getAsset.mockResolvedValue({
      symbol: 'AAPL',
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
    });
    alpacaService.getPositions.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/bars/AAPL')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.bars)).toBe(true);
    expect(res.body.bars.length).toBeGreaterThan(0);
    expect(res.body.symbol).toBe('AAPL');
    // Check bar shape
    const firstBar = res.body.bars[0];
    expect(firstBar).toHaveProperty('timestamp');
    expect(firstBar).toHaveProperty('open');
    expect(firstBar).toHaveProperty('high');
    expect(firstBar).toHaveProperty('low');
    expect(firstBar).toHaveProperty('close');
    expect(firstBar).toHaveProperty('volume');
  });

  it('returns 200 with AAPL bars when timeframe=1Hour is provided', async () => {
    alpacaService.getBars.mockResolvedValue(MOCK_BARS);
    alpacaService.getAsset.mockResolvedValue({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' });
    alpacaService.getPositions.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/bars/AAPL?timeframe=1Hour')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.timeframe).toBe('1Hour');
    expect(Array.isArray(res.body.bars)).toBe(true);
  });
});

describe('GET /api/v1/stocks/bars/ABSA.KE', () => {
  it('returns 200 with bars array from mystocks', async () => {
    ms.getStocks.mockResolvedValue([{
      symbol: 'ABSA.KE',
      name: 'Absa Bank Kenya',
      exchange: 'NSE',
      price: 14.5,
      previousClose: 14.2,
      currency: 'KES',
    }]);
    ms.getStockHistory = jest.fn().mockResolvedValue([
      { date: '2025-01-01', open: 14.0, high: 14.8, low: 13.9, close: 14.5, volume: 500000 },
      { date: '2025-01-02', open: 14.5, high: 15.0, low: 14.3, close: 14.8, volume: 480000 },
    ]);

    const res = await request(app)
      .get('/api/v1/stocks/bars/ABSA.KE')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('mystocks');
    expect(res.body.symbol).toBe('ABSA.KE');
    expect(Array.isArray(res.body.bars)).toBe(true);
    expect(res.body).toHaveProperty('ownership');
  });
});
