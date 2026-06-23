const PlatformSetting = require('../models/PlatformSetting');
const redisService = require('../config/redis');
const logger = require('../utils/logger');

const CACHE_TTL = 300; // 5 minutes
const DEFAULTS = {
  trade_fee_rate: 0.015,
  deposit_fee_rate: 0.015,
  withdrawal_fee_rate: 0.015,
  alpaca_enabled: 1,
  mystocks_enabled: 1,
};

async function getSetting(key) {
  const cacheKey = `platform_config:${key}`;
  try {
    const cached = await redisService.get(cacheKey);
    if (cached !== null && cached !== undefined) return parseFloat(cached);
  } catch (_) {}

  try {
    const row = await PlatformSetting.findByPk(key);
    const value = row ? parseFloat(row.value) : (DEFAULTS[key] ?? 0);
    try { await redisService.set(cacheKey, String(value), CACHE_TTL); } catch (_) {}
    return value;
  } catch (err) {
    logger.warn(`platformConfigService: failed to read ${key}, using default`, err.message);
    return DEFAULTS[key] ?? 0;
  }
}

async function getProviderFlags() {
  const [alpaca, mystocks] = await Promise.all([
    getSetting('alpaca_enabled'),
    getSetting('mystocks_enabled'),
  ]);
  return { alpacaEnabled: alpaca !== 0, mystocksEnabled: mystocks !== 0 };
}

async function setSetting(key, value) {
  await PlatformSetting.upsert({ key, value: String(value), updated_at: new Date() });
  try { await redisService.del(`platform_config:${key}`); } catch (_) {}
}

async function getAllSettings() {
  const rows = await PlatformSetting.findAll();
  return Object.fromEntries(rows.map(r => [r.key, { value: parseFloat(r.value), description: r.description }]));
}

module.exports = { getSetting, setSetting, getAllSettings, getProviderFlags };
