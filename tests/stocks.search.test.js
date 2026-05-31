const request = require('supertest');
const app = require('../src/server');

jest.mock('../src/services/alpacaService', () => ({
  searchAssets: jest.fn(),
  getLatestQuote: jest.fn(),
  getCompanyLogo: jest.fn((sym) => `https://logo/${sym}`),
}));
jest.mock('../src/services/mystocksService', () => ({
  getStocks: jest.fn(),
}));
jest.mock('../src/middleware/auth', () => ({
  auth: (req, _res, next) => { req.user = { id: 'test-user' }; next(); },
  requireKYCOrMyStocks: (_req, _res, next) => next(),
  requireKYC: (_req, _res, next) => next(),
  authorize: () => (_req, _res, next) => next(),
  requireBiometric: (_req, _res, next) => next(),
  requirePin: (_req, _res, next) => next(),
  adminAuth: (_req, _res, next) => next(),
}));

const alpacaService = require('../src/services/alpacaService');
const ms = require('../src/services/mystocksService');

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/stocks/search', () => {
  it('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/v1/stocks/search').set('Authorization', 'Bearer test');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns merged African + US results in correct shape', async () => {
    ms.getStocks.mockResolvedValue([
      { symbol: 'ABSA.KE', name: 'Absa Bank Kenya', exchange: 'NSE', price: 14.5, changePct: 1.2, currency: 'KES' }
    ]);
    alpacaService.searchAssets.mockResolvedValue([
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
    ]);
    alpacaService.getLatestQuote.mockResolvedValue({ ap: 178.5, bp: 178.4 });

    const res = await request(app)
      .get('/api/v1/stocks/search?q=a')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.results[0].symbol).toBe('ABSA.KE');
    expect(res.body.results[0].currency).toBe('KES');
    expect(res.body.results[0].priceChangePercent).toBe(1.2);
    expect(res.body.results[1].symbol).toBe('AAPL');
    expect(res.body.results[1].currentPrice).toBe(178.5);
    expect(res.body.results[1].currency).toBe('USD');

    for (const r of res.body.results) {
      expect(r).toHaveProperty('symbol');
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('exchange');
      expect(r).toHaveProperty('logo');
      expect(r).toHaveProperty('currentPrice');
      expect(r).toHaveProperty('priceChangePercent');
      expect(r).toHaveProperty('currency');
    }
  });

  it('returns only African results when Alpaca fails', async () => {
    ms.getStocks.mockResolvedValue([
      { symbol: 'ABSA.KE', name: 'Absa Bank Kenya', exchange: 'NSE', price: 14.5, changePct: 1.2, currency: 'KES' }
    ]);
    alpacaService.searchAssets.mockRejectedValue(new Error('Alpaca down'));

    const res = await request(app)
      .get('/api/v1/stocks/search?q=ABSA')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].symbol).toBe('ABSA.KE');
  });

  it('respects the limit param', async () => {
    const manyStocks = Array.from({ length: 15 }, (_, i) => ({
      symbol: `S${i}.KE`, name: `Stock ${i}`, exchange: 'NSE', price: 10, changePct: 0, currency: 'KES'
    }));
    ms.getStocks.mockResolvedValue(manyStocks);
    alpacaService.searchAssets.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/search?q=S&limit=5')
      .set('Authorization', 'Bearer test');

    expect(res.body.results).toHaveLength(5);
  });

  it('handles wrapped { stocks: [...] } response from MyStocks', async () => {
    ms.getStocks.mockResolvedValue({
      stocks: [
        { symbol: 'EQTY.KE', name: 'Equity Group', exchange: 'NSE', price: 52.0, changePct: 0.8, currency: 'KES' }
      ]
    });
    alpacaService.searchAssets.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/search?q=equity')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].symbol).toBe('EQTY.KE');
  });
});
