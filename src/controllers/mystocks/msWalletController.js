const ms = require('../../services/mystocksService');
const { User } = require('../../models');
const logger = require('../../utils/logger');

const getSubAccountId = async (userId) => {
  const user = await User.findByPk(userId, { attributes: ['mystocks_sub_account_id'] });
  if (!user?.mystocks_sub_account_id) {
    throw new Error('MyStocks sub-account not found. Please complete account setup.');
  }
  return user.mystocks_sub_account_id;
};

const getWallet = async (req, res) => {
  try {
    const subAccountId = await getSubAccountId(req.user.id);
    const data = await ms.getWallet(subAccountId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('MS getWallet error:', error.message);
    const status = error.message.includes('sub-account') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

const deposit = async (req, res) => {
  try {
    const subAccountId = await getSubAccountId(req.user.id);
    const { amount, currency = 'USD', localAmount, localCurrency, fxRate, reference } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, message: 'amount is required' });
    }

    const data = await ms.depositToSubAccount(subAccountId, {
      amount: Number(amount),
      currency,
      localAmount: localAmount ? Number(localAmount) : undefined,
      localCurrency,
      fxRate: fxRate ? Number(fxRate) : undefined,
      reference
    });

    logger.info(`MS deposit for user ${req.user.id}: ${amount} ${currency}`);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('MS deposit error:', error.message);
    const status = error.message.includes('sub-account') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

const withdraw = async (req, res) => {
  try {
    const subAccountId = await getSubAccountId(req.user.id);
    const { amount, currency = 'USD', reference } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, message: 'amount is required' });
    }

    const data = await ms.withdrawFromSubAccount(subAccountId, {
      amount: Number(amount),
      currency,
      reference
    });

    logger.info(`MS withdrawal for user ${req.user.id}: ${amount} ${currency}`);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('MS withdraw error:', error.message);
    const status = error.message.includes('sub-account') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

const getTransactions = async (req, res) => {
  try {
    const subAccountId = await getSubAccountId(req.user.id);
    const { page, limit } = req.query;
    const data = await ms.getTransactions(subAccountId, { page, limit });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('MS getTransactions error:', error.message);
    const status = error.message.includes('sub-account') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

module.exports = { getWallet, deposit, withdraw, getTransactions };
