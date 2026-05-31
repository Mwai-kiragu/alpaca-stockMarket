const request = require('supertest');
const app = require('../src/server');

jest.mock('../src/services/alpacaService', () => ({
  getTopMovers: jest.fn(),
  getNews: jest.fn(),
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

describe('GET /api/v1/stocks/trending', () => {
  it('returns correct shape with ranked stocks and topics', async () => {
    alpacaService.getTopMovers.mockResolvedValue({
      gainers: [
        { symbol: 'AMD', name: 'Advanced Micro Devices', price: 418.21, changePercent: 2.14 },
        { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 900.0, changePercent: 1.85 },
      ],
      losers: []
    });
    ms.getStocks.mockResolvedValue([
      { symbol: 'ABSA.KE', name: 'Absa Bank Kenya', price: 14.5, changePct: 2.5, currency: 'KES' },
      { symbol: 'EQTY.KE', name: 'Equity Group', price: 52.0, changePct: 1.9, currency: 'KES' },
      { symbol: 'SCOM.KE', name: 'Safaricom', price: 20.0, changePct: 0.5, currency: 'KES' },
    ]);
    alpacaService.getNews.mockResolvedValue([
      { headline: 'Bitcoin surges past $70k', id: '1' },
      { headline: 'Fed holds rates steady', id: '2' },
    ]);

    const res = await request(app)
      .get('/api/v1/stocks/trending')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // trendingStocks shape
    expect(Array.isArray(res.body.trendingStocks)).toBe(true);
    for (const s of res.body.trendingStocks) {
      expect(s).toHaveProperty('rank');
      expect(s).toHaveProperty('symbol');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('priceChangePercent');
      expect(s).toHaveProperty('currentPrice');
      expect(s).toHaveProperty('currency');
    }

    // ranks are sequential from 1
    const ranks = res.body.trendingStocks.map(s => s.rank);
    expect(ranks[0]).toBe(1);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    // NSE stock appears first (African-first interleave)
    expect(res.body.trendingStocks[0].symbol).toBe('ABSA.KE');

    // trendingTopics shape
    expect(Array.isArray(res.body.trendingTopics)).toBe(true);
    expect(res.body.trendingTopics[0]).toEqual({ rank: 1, title: 'Bitcoin surges past $70k' });
    expect(res.body.trendingTopics[1]).toEqual({ rank: 2, title: 'Fed holds rates steady' });
  });

  it('returns empty arrays when all sources fail', async () => {
    alpacaService.getTopMovers.mockRejectedValue(new Error('Alpaca down'));
    ms.getStocks.mockRejectedValue(new Error('MyStocks down'));
    alpacaService.getNews.mockRejectedValue(new Error('News down'));

    const res = await request(app)
      .get('/api/v1/stocks/trending')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.trendingStocks).toEqual([]);
    expect(res.body.trendingTopics).toEqual([]);
  });

  it('still returns US stocks when MyStocks fails', async () => {
    alpacaService.getTopMovers.mockResolvedValue({
      gainers: [{ symbol: 'AMD', name: 'Advanced Micro Devices', price: 418.21, changePercent: 2.14 }],
      losers: []
    });
    ms.getStocks.mockRejectedValue(new Error('MyStocks down'));
    alpacaService.getNews.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stocks/trending')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    const symbols = res.body.trendingStocks.map(s => s.symbol);
    expect(symbols).toContain('AMD');
  });
});
