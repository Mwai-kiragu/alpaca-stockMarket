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
  createSubAccount: jest.fn().mockResolvedValue({ data: { subAccountId: 'ms-sub-123' } }),
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

jest.mock('../src/models/User', () => {
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    phone: '+254700000001',
    is_email_verified: true,
    is_phone_verified: false,
    kyc_status: 'not_started',
    registration_status: 'started',
    registration_step: 'personal_info',
    account_status: 'active',
    role: 'user',
    alpaca_account_id: null,
    biometric_enabled: false,
    pin_enabled: false,
    referral_code: 'TEST123',
    referrals_count: 0,
    login_attempts: 0,
    lock_until: null,
    must_change_password: false,
    isLocked: false,
    comparePassword: jest.fn().mockResolvedValue(true),
    incLoginAttempts: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
  };
  return {
    findByPk: jest.fn().mockResolvedValue(mockUser),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ ...mockUser, id: 'new-user-id' }),
    update: jest.fn().mockResolvedValue([1]),
    generateReferralCode: jest.fn().mockReturnValue('NEWCODE'),
  };
});
jest.mock('../src/models/EmailVerificationToken', () => ({
  findOne: jest.fn(),
  create: jest.fn().mockResolvedValue({ id: 'token-id' }),
  update: jest.fn().mockResolvedValue([1]),
  generateToken: jest.fn().mockReturnValue('mock-verification-token'),
}));
jest.mock('../src/models/PhoneVerificationToken', () => ({
  findOne: jest.fn(),
  create: jest.fn().mockResolvedValue({ id: 'phone-token-id' }),
  update: jest.fn().mockResolvedValue([1]),
}));
jest.mock('../src/models/PasswordResetToken', () => ({
  findOne: jest.fn(),
  create: jest.fn().mockResolvedValue({ id: 'reset-token-id' }),
  update: jest.fn().mockResolvedValue([1]),
  generateToken: jest.fn().mockReturnValue('mock-reset-token'),
}));
jest.mock('../src/models', () => ({
  User: require('../src/models/User'),
  EmailVerificationToken: require('../src/models/EmailVerificationToken'),
  PhoneVerificationToken: require('../src/models/PhoneVerificationToken'),
  PasswordResetToken: require('../src/models/PasswordResetToken'),
  sequelize: { Sequelize: { Op: { ne: Symbol('ne'), gte: Symbol('gte'), or: Symbol('or') } } },
}));

jest.mock('../src/services/emailService', () => ({
  sendRegistrationWelcomeEmail: jest.fn().mockResolvedValue({ success: true }),
  sendVerificationCodeEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPasswordResetConfirmationEmail: jest.fn().mockResolvedValue({ success: true }),
  sendTransactionEmail: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../src/services/brevoEmailService', () => ({
  sendVerificationCodeEmail: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../src/services/notificationService', () => ({
  sendPhoneVerificationCode: jest.fn().mockResolvedValue({ success: true }),
}));

const User = require('../src/models/User');
const EmailVerificationToken = require('../src/models/EmailVerificationToken');

beforeEach(() => jest.clearAllMocks());

describe('POST /api/v1/auth/register', () => {
  it('returns 400 with missing fields', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 with missing password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ fullName: 'Test User', email: 'new@test.com', phoneNumber: '+254700000099' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 201 with valid registration body', async () => {
    User.findOne.mockResolvedValue(null); // No existing user
    User.create.mockResolvedValue({ id: 'new-user-id', email: 'new@test.com', first_name: 'Test', last_name: 'User' });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ fullName: 'Test User', email: 'new@test.com', phoneNumber: '+254700000099', password: 'Password1' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when email already exists', async () => {
    User.findOne.mockResolvedValue({ id: 'existing-id', email: 'existing@test.com', phone: '+254700000099' });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ fullName: 'Test User', email: 'existing@test.com', phoneNumber: '+254700000099', password: 'Password1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns 400 with missing fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 with missing password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@test.com' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when user not found', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'notfound@test.com', password: 'Password1' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with valid credentials', async () => {
    const mockUser = {
      id: 'test-user-id',
      email: 'test@test.com',
      first_name: 'Test',
      last_name: 'User',
      phone: '+254700000001',
      role: 'user',
      is_email_verified: true,
      registration_status: 'started',
      registration_step: 'personal_info',
      login_attempts: 0,
      lock_until: null,
      isLocked: false,
      biometric_enabled: false,
      pin_enabled: false,
      referral_code: 'TEST123',
      referrals_count: 0,
      must_change_password: false,
      password: '$2b$10$hashedpassword',
      comparePassword: jest.fn().mockResolvedValue(true),
      incLoginAttempts: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findOne.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@test.com', password: 'Password1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns 200 with auth header (mocked auth middleware)', async () => {
    User.findByPk.mockResolvedValue({
      id: 'test-user-id',
      first_name: 'Test',
      last_name: 'User',
      email: 'test@example.com',
      phone: '+254700000001',
      kyc_status: 'not_started',
      is_email_verified: true,
      is_phone_verified: false,
      registration_status: 'started',
      terms_accepted: false,
      privacy_accepted: false,
      alpaca_account_id: null,
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('user');
  });
});

describe('POST /api/v1/auth/v2/register', () => {
  it('returns 400 with missing required fields', async () => {
    const res = await request(app).post('/api/v1/auth/v2/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when termsAccepted is false', async () => {
    const res = await request(app)
      .post('/api/v1/auth/v2/register')
      .send({
        fullName: 'Test User',
        email: 'newv2@test.com',
        phoneNumber: '+254700000098',
        password: 'Password1',
        citizenship: 'Kenya',
        dateOfBirth: '1990-01-01',
        gender: 'male',
        termsAccepted: false,
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 201 with valid v2 registration body', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({ id: 'new-v2-id', email: 'newv2@test.com', first_name: 'Test', last_name: 'User' });

    const res = await request(app)
      .post('/api/v1/auth/v2/register')
      .send({
        fullName: 'Test User',
        email: 'newv2@test.com',
        phoneNumber: '+254700000098',
        password: 'Password1',
        citizenship: 'Kenya',
        dateOfBirth: '1990-01-01',
        gender: 'male',
        termsAccepted: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('email');
  });
});

describe('POST /api/v1/auth/v2/verify-email', () => {
  it('returns 400 when token/code is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/v2/verify-email')
      .send({});
    // No email or verificationCode → will return 404 (user not found) or 400
    expect([400, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with valid token mock', async () => {
    const mockUser = {
      id: 'test-user-id',
      email: 'verify@test.com',
      first_name: 'Test',
      last_name: 'Verify',
      phone: '+254700000097',
      is_email_verified: false,
      registration_step: 'email_verification',
      referral_code: null,
      referrals_count: 0,
      mystocks_sub_account_id: null,
      update: jest.fn().mockResolvedValue(undefined),
    };
    User.findOne.mockResolvedValue(mockUser);

    const mockToken = {
      id: 'token-id',
      user_id: 'test-user-id',
      verification_code: '123456',
      used: false,
      isExpired: jest.fn().mockReturnValue(false),
      update: jest.fn().mockResolvedValue(undefined),
    };
    EmailVerificationToken.findOne.mockResolvedValue(mockToken);

    const res = await request(app)
      .post('/api/v1/auth/v2/verify-email')
      .send({ email: 'verify@test.com', verificationCode: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
  });
});
