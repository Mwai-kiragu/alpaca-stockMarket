const request = require('supertest');
const app = require('../src/server');

jest.mock('../src/services/alpacaService', () => ({
  searchAssets: jest.fn(),
  getLatestQuote: jest.fn(),
  getCompanyLogo: jest.fn((sym) => `https://logo/${sym}`),
  getAssets: jest.fn(),
  getAsset: jest.fn(),
  getTopMovers: jest.fn(),
  getNews: jest.fn(),
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
  it('returns 400 when no params provided', async () => {
    const res = await request(app).get('/api/v1/stocks/search').set('Authorization', 'Bearer test');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when only limit is provided', async () => {
    const res = await request(app).get('/api/v1/stocks/search?limit=10').set('Authorization', 'Bearer test');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // --- q param (free-text dual-source) ---

  it('q: returns merged African + US results in correct shape', async () => {
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

  it('q: returns only African results when Alpaca fails', async () => {
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

  it('q: handles wrapped { stocks: [...] } response from MyStocks', async () => {
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

  // --- category param ---

  it('category=african_equity: queries MyStocks only', async () => {
    ms.getStocks.mockResolvedValue([
      { symbol: 'SCOM.KE', name: 'Safaricom', exchange: 'NSE', price: 20.0, changePct: 0.5, currency: 'KES' }
    ]);

    const res = await request(app)
      .get('/api/v1/stocks/search?category=african_equity')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(ms.getStocks).toHaveBeenCalled();
    expect(alpacaService.searchAssets).not.toHaveBeenCalled();
    expect(alpacaService.getAssets).not.toHaveBeenCalled();
    expect(res.body.results[0].symbol).toBe('SCOM.KE');
  });

  it('category=us_equity: queries Alpaca assets only', async () => {
    alpacaService.getAssets.mockResolvedValue([
      { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' }
    ]);
    alpacaService.getLatestQuote.mockResolvedValue({ ap: 420.0 });

    const res = await request(app)
      .get('/api/v1/stocks/search?category=us_equity')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(alpacaService.getAssets).toHaveBeenCalledWith('active', 'us_equity', null);
    expect(ms.getStocks).not.toHaveBeenCalled();
    expect(res.body.results[0].symbol).toBe('MSFT');
    expect(res.body.results[0].currency).toBe('USD');
  });

  it('category=etf: queries Alpaca with us_etf asset class', async () => {
    alpacaService.getAssets.mockResolvedValue([
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'NYSE' }
    ]);
    alpacaService.getLatestQuote.mockResolvedValue({ ap: 520.0 });

    const res = await request(app)
      .get('/api/v1/stocks/search?category=etf')
      .set('Authorization', 'Bearer test');

    expect(alpacaService.getAssets).toHaveBeenCalledWith('active', 'us_etf', null);
    expect(res.body.results[0].symbol).toBe('SPY');
  });

  // --- sort param ---

  it('sort=top_gainers: returns results sorted by priceChangePercent DESC', async () => {
    alpacaService.getTopMovers.mockResolvedValue({
      gainers: [{ symbol: 'AMD', name: 'AMD', price: 100, changePercent: 3.0 }],
      losers: [{ symbol: 'INTC', name: 'Intel', price: 50, changePercent: -2.0 }]
    });
    ms.getStocks.mockResolvedValue([
      { symbol: 'ABSA.KE', name: 'Absa', price: 14, changePct: 1.5, currency: 'KES' }
    ]);

    const res = await request(app)
      .get('/api/v1/stocks/search?sort=top_gainers')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    const percs = res.body.results.map(r => r.priceChangePercent);
    expect(percs[0]).toBeGreaterThanOrEqual(percs[percs.length - 1]);
  });

  it('sort=top_losers: returns results sorted by priceChangePercent ASC', async () => {
    alpacaService.getTopMovers.mockResolvedValue({
      gainers: [{ symbol: 'AMD', name: 'AMD', price: 100, changePercent: 3.0 }],
      losers: [{ symbol: 'INTC', name: 'Intel', price: 50, changePercent: -2.0 }]
    });
    ms.getStocks.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/search?sort=top_losers')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    const percs = res.body.results.map(r => r.priceChangePercent);
    expect(percs[0]).toBeLessThanOrEqual(percs[percs.length - 1]);
  });

  // --- exchange param ---

  it('exchange=NSE: queries MyStocks with that exchange', async () => {
    ms.getStocks.mockResolvedValue([
      { symbol: 'ABSA.KE', name: 'Absa', exchange: 'NSE', price: 14, changePct: 1.2, currency: 'KES' }
    ]);

    const res = await request(app)
      .get('/api/v1/stocks/search?exchange=NSE')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(ms.getStocks).toHaveBeenCalledWith(expect.objectContaining({ exchange: 'NSE' }));
    expect(res.body.results[0].symbol).toBe('ABSA.KE');
  });

  it('exchange=NASDAQ: queries Alpaca assets filtered by exchange', async () => {
    alpacaService.getAssets.mockResolvedValue([
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
    ]);
    alpacaService.getLatestQuote.mockResolvedValue({ ap: 178.5 });

    const res = await request(app)
      .get('/api/v1/stocks/search?exchange=NASDAQ')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(alpacaService.getAssets).toHaveBeenCalledWith('active', 'us_equity', 'NASDAQ');
    expect(res.body.results[0].symbol).toBe('AAPL');
  });
});
