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
  getAccount: jest.fn(),
  getPositions: jest.fn(),
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
  getPortfolio: jest.fn(),
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

jest.mock('../src/models/Order', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  findByPk: jest.fn(),
  create: jest.fn(),
  findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
  sequelize: { Sequelize: { Op: { notIn: Symbol('notIn'), between: Symbol('between') } } },
}));
jest.mock('../src/models/DemoOrder', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../src/models/MsOrder', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn(),
}));

const mockDemoUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  alpaca_account_id: null, // No alpaca account → demo/African mode
  mystocks_sub_account_id: null,
  account_mode: 'demo',
  demo_balance: 10000,
  mystocks_wallet_balance: 0,
};

jest.mock('../src/models', () => ({
  User: {
    findByPk: jest.fn().mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'User',
      alpaca_account_id: null,
      mystocks_sub_account_id: null,
      account_mode: 'demo',
      demo_balance: 10000,
      mystocks_wallet_balance: 0,
    }),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue([1]),
  },
  Order: require('../src/models/Order'),
  DemoOrder: require('../src/models/DemoOrder'),
  MsOrder: require('../src/models/MsOrder'),
  Wallet: {
    findOne: jest.fn().mockResolvedValue({ kes_balance: 0, usd_balance: 0, frozen_kes: 0, frozen_usd: 0 }),
    create: jest.fn(),
  },
  Transaction: { findAll: jest.fn().mockResolvedValue([]), create: jest.fn() },
  Watchlist: { findOne: jest.fn().mockResolvedValue(null) },
  sequelize: { Sequelize: { Op: { ne: Symbol('ne'), gte: Symbol('gte'), or: Symbol('or'), notIn: Symbol('notIn'), between: Symbol('between') } } },
}));

const alpacaService = require('../src/services/alpacaService');
const ms = require('../src/services/mystocksService');
const { User } = require('../src/models');
const DemoOrder = require('../src/models/DemoOrder');

beforeEach(() => {
  jest.clearAllMocks();
  User.findByPk.mockResolvedValue({ ...mockDemoUser });
  DemoOrder.findAll.mockResolvedValue([]);
});

describe('GET /api/v1/portfolio', () => {
  it('returns 200 with demo portfolio when account_mode=demo', async () => {
    const res = await request(app)
      .get('/api/v1/portfolio')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('demo');
    expect(res.body.accountMode).toBe('demo');
    expect(res.body).toHaveProperty('portfolio');
    expect(res.body.portfolio).toHaveProperty('summary');
    expect(res.body.portfolio).toHaveProperty('positions');
    expect(res.body.portfolio.summary).toHaveProperty('totalEquity');
    expect(res.body.portfolio.summary).toHaveProperty('buyingPower');
    expect(res.body.portfolio.summary.demoBalance).toBe(10000);
  });

  it('demo portfolio positions array is empty when no demo orders exist', async () => {
    DemoOrder.findAll.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/portfolio')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.portfolio.positions).toHaveLength(0);
  });
});

describe('GET /api/v1/portfolio/positions', () => {
  it('returns 200 with positions array', async () => {
    // User has no alpaca account → MyStocks fallback path
    const res = await request(app)
      .get('/api/v1/portfolio/positions')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.positions)).toBe(true);
    expect(res.body).toHaveProperty('summary');
  });

  it('returns positions from alpaca when user has alpaca_account_id', async () => {
    User.findByPk.mockResolvedValue({
      ...mockDemoUser,
      alpaca_account_id: 'alp-123',
      account_mode: 'live',
    });
    alpacaService.getPositions.mockResolvedValue([
      {
        symbol: 'AAPL',
        qty: '2',
        market_value: '357.0',
        cost_basis: '340.0',
        unrealized_pl: '17.0',
        unrealized_plpc: '0.05',
        avg_entry_price: '170.0',
        current_price: '178.5',
        change_today: '1.5',
        lastday_price: '177.0',
        side: 'long',
        exchange: 'NASDAQ',
        asset_class: 'us_equity',
      },
    ]);
    alpacaService.getLatestQuote.mockResolvedValue({ ap: 178.5, bp: 178.4 });
    const Order = require('../src/models/Order');
    Order.findAll.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/portfolio/positions')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.positions)).toBe(true);
  });
});

describe('GET /api/v1/portfolio/allocation', () => {
  it('returns 200 with allocation breakdown', async () => {
    const res = await request(app)
      .get('/api/v1/portfolio/allocation')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('allocation');
    expect(res.body.allocation).toHaveProperty('byAssetClass');
    expect(res.body.allocation).toHaveProperty('bySector');
    expect(res.body.allocation).toHaveProperty('byStock');
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('exchangeRate');
  });

  it('returns 200 with alpaca-based allocation when user has alpaca_account_id', async () => {
    User.findByPk.mockResolvedValue({
      ...mockDemoUser,
      alpaca_account_id: 'alp-123',
      account_mode: 'live',
    });
    alpacaService.getAccount.mockResolvedValue({ cash: '5000', equity: '5500' });
    alpacaService.getPositions.mockResolvedValue([
      {
        symbol: 'AAPL',
        qty: '2',
        market_value: '357.0',
        cost_basis: '340.0',
        unrealized_pl: '17.0',
        unrealized_plpc: '0.05',
        avg_entry_price: '170.0',
        current_price: '178.5',
        exchange: 'NASDAQ',
        asset_class: 'us_equity',
      },
    ]);
    alpacaService.getAsset.mockResolvedValue({ symbol: 'AAPL', exchange: 'NASDAQ', class: 'us_equity' });

    const res = await request(app)
      .get('/api/v1/portfolio/allocation')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('allocation');
  });
});
