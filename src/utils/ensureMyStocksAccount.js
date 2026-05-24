const ms = require('../services/mystocksService');
const { User } = require('../models');
const logger = require('./logger');

const assertKYC = async (subAccountId, userId) => {
  try {
    await ms.updateKYC(subAccountId, {
      status: 'VERIFIED',
      level: 'BASIC',
      reference: `riven-user-${userId}`
    });
    logger.info(`MyStocks KYC asserted (BASIC) for sub-account ${subAccountId}`);
  } catch (kycErr) {
    logger.warn(`MyStocks KYC assertion failed for ${subAccountId}: ${kycErr.message}`);
  }
};

const ensureMyStocksSubAccount = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'mystocks_sub_account_id', 'first_name', 'last_name', 'email']
  });
  if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });

  if (user.mystocks_sub_account_id) {
    // Always ensure KYC is asserted — fire-and-forget, doesn't block the caller
    assertKYC(user.mystocks_sub_account_id, user.id);
    return user.mystocks_sub_account_id;
  }

  try {
    const existing = await ms.getSubAccountByExternalId(user.id);
    const accounts = existing?.accounts || (Array.isArray(existing?.data) ? existing.data : []);
    const existingId = accounts[0]?.subAccountId || accounts[0]?.id || existing?.subAccountId || existing?.id;
    if (existingId) {
      await user.update({ mystocks_sub_account_id: existingId });
      logger.info(`MyStocks sub-account recovered for user ${user.id}: ${existingId}`);
      assertKYC(existingId, user.id);
      return existingId;
    }
  } catch (_) {}

  const created = await ms.createSubAccount({
    externalId: user.id,
    displayName: `${user.first_name} ${user.last_name}`.trim(),
    email: user.email
  });
  const newId = created?.subAccountId || created?.data?.subAccountId || created?.id || created?.data?.id || created?.userId || created?.data?.userId || created?._locationId;
  if (!newId) throw new Error('MyStocks sub-account creation failed. Please try again.');

  await user.update({ mystocks_sub_account_id: newId });
  logger.info(`MyStocks sub-account created for user ${user.id}: ${newId}`);
  assertKYC(newId, user.id);

  return newId;
};

module.exports = { ensureMyStocksSubAccount };
