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
  getWallet: jest.fn().mockResolvedValue({ wallet: { balance: 0 }, balance: 0 }),
  placeTrade: jest.fn(),
  getOrders: jest.fn(),
  createSubAccount: jest.fn(),
  getSubAccount: jest.fn(),
}));
jest.mock('../src/services/exchangeService', () => ({
  getExchangeRate: jest.fn().mockResolvedValue(129.26),
  convertCurrency: jest.fn().mockResolvedValue({ convertedAmount: 0.00774, rate: 0.00774 }),
  getCurrentRates: jest.fn().mockResolvedValue({
    base: 'USD',
    rates: { USD: 1, KES: 129.26, NGN: 1600, ZAR: 18.5, GHS: 15.5 },
    timestamp: new Date().toISOString(),
  }),
  calculateForexFees: jest.fn().mockReturnValue(0.001),
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

const mockWalletInstance = {
  id: 'wallet-123',
  user_id: 'test-user-id',
  kes_balance: 1000,
  usd_balance: 50,
  frozen_kes: 0,
  frozen_usd: 0,
  save: jest.fn().mockResolvedValue(undefined),
  update: jest.fn().mockResolvedValue(undefined),
  unfreezeFunds: jest.fn().mockResolvedValue(undefined),
  freezeFunds: jest.fn().mockResolvedValue(undefined),
  addTransaction: jest.fn().mockResolvedValue({ id: 'txn-123' }),
};

const mockTransactions = [
  {
    id: 'txn-1',
    wallet_id: 'wallet-123',
    type: 'deposit',
    amount: 500,
    currency: 'KES',
    status: 'completed',
    reference: 'DEP_001',
    created_at: new Date().toISOString(),
  },
  {
    id: 'txn-2',
    wallet_id: 'wallet-123',
    type: 'trade_buy',
    amount: -50,
    currency: 'USD',
    status: 'completed',
    reference: 'ORDER_001',
    created_at: new Date().toISOString(),
  },
];

// Mock the Wallet model from models/Wallet.js (separate file)
jest.mock('../src/models/Wallet', () => ({
  Wallet: {
    findOne: jest.fn(),
    create: jest.fn(),
    findByPk: jest.fn(),
  },
  Transaction: {
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../src/models', () => ({
  User: {
    findByPk: jest.fn().mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      mystocks_sub_account_id: null,
      mystocks_wallet_balance: 0,
      account_mode: 'demo',
      demo_balance: 10000,
      auto_convert_deposits: false,
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
    }),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue([1]),
  },
  Order: {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn(),
    findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    sequelize: { Sequelize: { Op: { notIn: Symbol('notIn'), between: Symbol('between') } } },
  },
  DemoOrder: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn() },
  MsOrder: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn() },
  Wallet: {
    findOne: jest.fn(),
    create: jest.fn(),
    findByPk: jest.fn(),
  },
  Transaction: {
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  },
  Watchlist: { findOne: jest.fn().mockResolvedValue(null) },
  sequelize: { Sequelize: { Op: { ne: Symbol('ne'), gte: Symbol('gte'), or: Symbol('or'), notIn: Symbol('notIn'), between: Symbol('between') } } },
}));

// Mock kcbService (used in wallet routes sometimes)
jest.mock('../src/services/kcbService', () => ({
  initiateStkPush: jest.fn(),
  checkTransactionStatus: jest.fn(),
}));

// Re-require mocked wallet model
const { Wallet: WalletModel, Transaction: TransactionModel } = require('../src/models/Wallet');

beforeEach(() => {
  jest.clearAllMocks();
  WalletModel.findOne.mockResolvedValue({ ...mockWalletInstance });
  WalletModel.create.mockResolvedValue({ ...mockWalletInstance });
  TransactionModel.findAndCountAll.mockResolvedValue({ count: 2, rows: mockTransactions });
  TransactionModel.create.mockResolvedValue({ id: 'txn-new' });
});

describe('GET /api/v1/wallet', () => {
  it('returns 200 with wallet including balance fields', async () => {
    const res = await request(app)
      .get('/api/v1/wallet')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('wallet');
    expect(res.body.wallet).toHaveProperty('kesBalance');
    expect(res.body.wallet).toHaveProperty('usdBalance');
    expect(res.body.wallet).toHaveProperty('exchangeRate');
    expect(res.body.wallet).toHaveProperty('totalValueKes');
  });

  it('creates a wallet and returns 200 when wallet does not exist', async () => {
    WalletModel.findOne.mockResolvedValue(null);
    WalletModel.create.mockResolvedValue({ ...mockWalletInstance, kes_balance: 0, usd_balance: 0 });

    const res = await request(app)
      .get('/api/v1/wallet')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('wallet');
  });
});

describe('GET /api/v1/wallet/transactions', () => {
  it('returns 200 with paginated transactions', async () => {
    const res = await request(app)
      .get('/api/v1/wallet/transactions')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toHaveProperty('currentPage');
    expect(res.body.pagination).toHaveProperty('totalPages');
    expect(res.body.pagination).toHaveProperty('totalTransactions');
  });
});

describe('GET /api/v1/wallet/rates', () => {
  it('returns 200 with exchange rates object', async () => {
    const res = await request(app)
      .get('/api/v1/wallet/rates')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The response spreads the result of exchangeService.getCurrentRates()
    // so it should have at least a rates property or direct rate values
    expect(res.body).toBeTruthy();
  });
});

describe('GET /api/v1/wallet/rates/USD/KES', () => {
  it('returns 200 with specific rate for USD/KES pair', async () => {
    const exchangeService = require('../src/services/exchangeService');
    exchangeService.getExchangeRate.mockResolvedValue(129.26);
    exchangeService.convertCurrency.mockResolvedValue({ convertedAmount: 129.26, rate: 129.26 });

    const res = await request(app)
      .get('/api/v1/wallet/rates/USD/KES')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('rate');
    expect(res.body).toHaveProperty('pair');
    expect(res.body.pair).toBe('USD/KES');
    expect(res.body.rate).toBe(129.26);
  });
});
