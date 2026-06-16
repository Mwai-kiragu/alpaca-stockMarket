const PlatformRevenue = require('../models/PlatformRevenue');
const logger = require('../utils/logger');

/**
 * Record a platform fee. Fire-and-forget — never throws.
 * @param {'trade_fee'|'deposit_fee'|'withdrawal_fee'|'forex_fee'} type
 * @param {{ userId, amountUsd?, amountKes?, currency?, reference? }} opts
 */
async function recordRevenue(type, { userId, amountUsd = null, amountKes = null, currency = 'USD', reference = null }) {
  try {
    await PlatformRevenue.create({
      user_id: userId,
      type,
      amount_usd: amountUsd,
      amount_kes: amountKes,
      currency,
      reference,
    });
  } catch (err) {
    logger.error(`revenueService: failed to record ${type} for user ${userId}:`, err.message);
  }
}

module.exports = { recordRevenue };
