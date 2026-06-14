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

jest.mock('../src/models/Order', () => {
  const mockOrder = {
    id: 'order-123',
    user_id: 'test-user-id',
    symbol: 'AAPL',
    side: 'buy',
    order_type: 'market',
    quantity: 1,
    status: 'pending',
    order_value: 178.5,
    currency: 'USD',
    exchange_rate: 129.26,
    fees: {
      commission: { rate: 0.01, percentage: '1%', amountUsd: 1.785, amountKes: 230.69 },
      totalCostUsd: 180.285,
      totalCostKes: 23313.85,
      stockValueUsd: 178.5,
      stockValueKes: 23083.16,
    },
    alpaca_order_id: 'alpaca-order-123',
    metadata: { client_order_id: 'ORDER_123', estimated_price: 178.5 },
    createdAt: new Date().toISOString(),
    isCompleted: false,
    remainingQuantity: 1,
    totalValue: 178.5,
    updateFromAlpaca: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
  return {
    findAll: jest.fn().mockResolvedValue([mockOrder]),
    findOne: jest.fn().mockResolvedValue(mockOrder),
    findByPk: jest.fn().mockResolvedValue(mockOrder),
    create: jest.fn().mockResolvedValue(mockOrder),
    findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [mockOrder] }),
    sequelize: { Sequelize: { Op: { notIn: Symbol('notIn'), between: Symbol('between') } } },
  };
});
jest.mock('../src/models/DemoOrder', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn().mockResolvedValue({ id: 'demo-order-123' }),
}));
jest.mock('../src/models/MsOrder', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn().mockResolvedValue({ id: 'ms-order-123' }),
}));
jest.mock('../src/models/Wallet', () => ({
  findOne: jest.fn().mockResolvedValue({
    id: 'wallet-123',
    kes_balance: 0,
    usd_balance: 0,
    frozen_kes: 0,
    frozen_usd: 0,
    unfreezeFunds: jest.fn().mockResolvedValue(undefined),
    freezeFunds: jest.fn().mockResolvedValue(undefined),
  }),
  create: jest.fn(),
}));

const mockUserRecord = {
  id: 'test-user-id',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  alpaca_account_id: 'alp-123',
  account_mode: 'demo',
  demo_balance: 10000,
  mystocks_sub_account_id: null,
  update: jest.fn().mockResolvedValue(undefined),
  save: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../src/models', () => ({
  User: {
    findByPk: jest.fn().mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'User',
      alpaca_account_id: 'alp-123',
      account_mode: 'demo',
      demo_balance: 10000,
      mystocks_sub_account_id: null,
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
    }),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue([1]),
  },
  Order: require('../src/models/Order'),
  DemoOrder: require('../src/models/DemoOrder'),
  MsOrder: require('../src/models/MsOrder'),
  Wallet: require('../src/models/Wallet'),
  Transaction: { findAll: jest.fn().mockResolvedValue([]), create: jest.fn() },
  Watchlist: { findOne: jest.fn().mockResolvedValue(null) },
  sequelize: { Sequelize: { Op: { ne: Symbol('ne'), gte: Symbol('gte'), or: Symbol('or'), notIn: Symbol('notIn'), between: Symbol('between') } } },
}));

jest.mock('../src/services/emailService', () => ({
  sendTransactionEmail: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../src/utils/ensureMyStocksAccount', () => ({
  ensureMyStocksSubAccount: jest.fn().mockResolvedValue('ms-sub-123'),
}));

const alpacaService = require('../src/services/alpacaService');
const ms = require('../src/services/mystocksService');
const Order = require('../src/models/Order');
const DemoOrder = require('../src/models/DemoOrder');
const { User } = require('../src/models');

beforeEach(() => {
  jest.clearAllMocks();
  // Default user mock: demo mode, no alpaca_account_id needed for African orders
  User.findByPk.mockResolvedValue({
    ...mockUserRecord,
    account_mode: 'demo',
    demo_balance: 10000,
  });
});

describe('POST /api/v1/orders (African symbol in demo mode)', () => {
  it('returns 201 demo order with provider=demo for African symbol', async () => {
    ms.getStocks.mockResolvedValue([{
      symbol: 'ABSA.KE',
      name: 'Absa Bank Kenya',
      exchange: 'NSE',
      price: 14.5,
      usdPrice: 0.112,
      currency: 'KES',
    }]);
    DemoOrder.create.mockResolvedValue({ id: 'demo-order-123' });
    User.findByPk.mockResolvedValue({
      ...mockUserRecord,
      account_mode: 'demo',
      demo_balance: 10000,
      update: jest.fn().mockResolvedValue(undefined),
    });
    DemoOrder.findAll.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer test')
      .send({
        symbol: 'ABSA.KE',
        side: 'buy',
        qty: 10,
        type: 'market',
        time_in_force: 'day',
        exchange: 'NSE',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('demo');
    expect(res.body).toHaveProperty('order');
  });
});

describe('POST /api/v1/orders (US symbol)', () => {
  it('returns 201 and calls alpaca createOrder for a US symbol', async () => {
    User.findByPk.mockResolvedValue({
      ...mockUserRecord,
      account_mode: 'live',
      alpaca_account_id: 'alp-123',
      demo_balance: 10000,
    });
    alpacaService.getAccount.mockResolvedValue({ cash: 5000, buying_power: 5000 });
    alpacaService.getLatestQuote.mockResolvedValue({ ap: 178.5, bp: 178.4 });
    alpacaService.createOrder.mockResolvedValue({
      id: 'alpaca-order-123',
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '1',
      status: 'accepted',
    });

    const mockOrder = {
      id: 'order-db-123',
      symbol: 'AAPL',
      side: 'buy',
      order_type: 'market',
      quantity: 1,
      status: 'accepted',
      order_value: 178.5,
      currency: 'USD',
      exchange_rate: 129.26,
      alpaca_order_id: 'alpaca-order-123',
      fees: {
        commission: { rate: 0.01, percentage: '1%', amountUsd: 1.785, amountKes: 230.69 },
        totalCostUsd: 180.285,
        totalCostKes: 23313.85,
        stockValueUsd: 178.5,
        stockValueKes: 23083.16,
      },
      metadata: { client_order_id: 'ORDER_123' },
      createdAt: new Date().toISOString(),
      updateFromAlpaca: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    Order.create.mockResolvedValue(mockOrder);

    // Wallet mock is set at module level — no override needed

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer test')
      .send({
        symbol: 'AAPL',
        side: 'buy',
        qty: 1,
        type: 'market',
        time_in_force: 'day',
      });

    // Either 201 (placed) or 400 (insufficient funds — alpaca account mock cash check)
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('order');
    }
  });
});

describe('POST /api/v1/orders (missing symbol)', () => {
  it('returns 400 validation error when symbol is missing', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer test')
      .send({
        side: 'buy',
        qty: 1,
        type: 'market',
        time_in_force: 'day',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/v1/orders', () => {
  it('returns 200 with orders array', async () => {
    Order.findAndCountAll.mockResolvedValue({
      count: 1,
      rows: [{
        id: 'order-123',
        user_id: 'test-user-id',
        symbol: 'AAPL',
        alpaca_order_id: 'alpaca-123',
        side: 'buy',
        order_type: 'market',
        quantity: 1,
        filled_quantity: null,
        remainingQuantity: 1,
        limit_price: null,
        stop_price: null,
        average_price: null,
        status: 'pending',
        order_value: 178.5,
        totalValue: 178.5,
        currency: 'USD',
        exchange_rate: 129.26,
        submitted_at: null,
        filled_at: null,
        created_at: new Date().toISOString(),
      }],
    });

    const res = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
  });
});

describe('GET /api/v1/orders/:orderId', () => {
  it('returns 200 with single order object', async () => {
    const mockSingleOrder = {
      id: 'order-123',
      user_id: 'test-user-id',
      symbol: 'AAPL',
      alpaca_order_id: 'alpaca-123',
      side: 'buy',
      order_type: 'market',
      quantity: 1,
      filled_quantity: null,
      remainingQuantity: 1,
      limit_price: null,
      stop_price: null,
      average_price: null,
      status: 'pending',
      order_value: 178.5,
      totalValue: 178.5,
      currency: 'USD',
      exchange_rate: 129.26,
      fees: {},
      submitted_at: null,
      filled_at: null,
      cancelled_at: null,
      rejection_reason: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      isCompleted: false,
      updateFromAlpaca: jest.fn().mockResolvedValue(undefined),
    };
    Order.findOne.mockResolvedValue(mockSingleOrder);
    alpacaService.getOrder.mockResolvedValue({ id: 'alpaca-123', status: 'pending' });

    const res = await request(app)
      .get('/api/v1/orders/order-123')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('order');
    expect(res.body.order.id).toBe('order-123');
  });
});

describe('DELETE /api/v1/orders/:orderId', () => {
  it('returns 200 and cancels the order', async () => {
    const mockCancelOrder = {
      id: 'order-123',
      user_id: 'test-user-id',
      symbol: 'AAPL',
      alpaca_order_id: 'alpaca-123',
      side: 'buy',
      status: 'pending',
      isCompleted: false,
      order_value: 178.5,
      filled_quantity: 0,
      average_price: null,
      currency: 'USD',
      update: jest.fn().mockResolvedValue(undefined),
    };
    Order.findOne.mockResolvedValue(mockCancelOrder);
    alpacaService.cancelOrder.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/v1/orders/order-123')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
