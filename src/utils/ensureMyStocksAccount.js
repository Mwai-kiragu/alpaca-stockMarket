const ms = require('../services/mystocksService');
const { User } = require('../models');
const logger = require('./logger');

const ensureMyStocksSubAccount = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'mystocks_sub_account_id', 'first_name', 'last_name', 'email']
  });
  if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });

  if (user.mystocks_sub_account_id) return user.mystocks_sub_account_id;

  try {
    const existing = await ms.getSubAccountByExternalId(user.id);
    const accounts = existing?.accounts || (Array.isArray(existing?.data) ? existing.data : []);
    const existingId = accounts[0]?.subAccountId || accounts[0]?.id || existing?.subAccountId || existing?.id;
    if (existingId) {
      await user.update({ mystocks_sub_account_id: existingId });
      logger.info(`MyStocks sub-account recovered for user ${user.id}: ${existingId}`);
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

  try {
    await ms.updateKYC(newId, {
      status: 'VERIFIED',
      level: 'BASIC',
      reference: `riven-user-${user.id}`
    });
    logger.info(`MyStocks KYC asserted (BASIC) for sub-account ${newId}`);
  } catch (kycErr) {
    logger.warn(`MyStocks KYC assertion failed for ${newId}: ${kycErr.message}`);
  }

  return newId;
};

module.exports = { ensureMyStocksSubAccount };
