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

const listBonds = async (req, res) => {
  try {
    const { type, currency, exchange } = req.query;
    const data = await ms.getBonds({ type, currency, exchange });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('MS listBonds error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch bonds' });
  }
};

const getBond = async (req, res) => {
  try {
    const data = await ms.getBond(req.params.bondId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('MS getBond error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch bond' });
  }
};

const subscribeToBond = async (req, res) => {
  try {
    const subAccountId = await getSubAccountId(req.user.id);
    const { bondId, units } = req.body;
    if (!bondId || !units) {
      return res.status(400).json({ success: false, message: 'bondId and units are required' });
    }
    const data = await ms.subscribeToBond(subAccountId, { bondId, units: Number(units) });
    res.status(202).json({ success: true, data });
  } catch (error) {
    logger.error('MS subscribeToBond error:', error.message);
    const status = error.message.includes('sub-account') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

const listFunds = async (req, res) => {
  try {
    const { category, currency } = req.query;
    const data = await ms.getFunds({ category, currency });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('MS listFunds error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch funds' });
  }
};

const getFund = async (req, res) => {
  try {
    const data = await ms.getFund(req.params.fundId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('MS getFund error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch fund' });
  }
};

const subscribeToFund = async (req, res) => {
  try {
    const subAccountId = await getSubAccountId(req.user.id);
    const { fundId, units } = req.body;
    if (!fundId || !units) {
      return res.status(400).json({ success: false, message: 'fundId and units are required' });
    }
    const data = await ms.subscribeToFund(subAccountId, { fundId, units: Number(units) });
    res.status(202).json({ success: true, data });
  } catch (error) {
    logger.error('MS subscribeToFund error:', error.message);
    const status = error.message.includes('sub-account') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

const redeemFund = async (req, res) => {
  try {
    const subAccountId = await getSubAccountId(req.user.id);
    const { holdingId, units } = req.body;
    if (!holdingId || !units) {
      return res.status(400).json({ success: false, message: 'holdingId and units are required' });
    }
    const data = await ms.redeemFund(subAccountId, { holdingId, units: Number(units) });
    res.status(202).json({ success: true, data });
  } catch (error) {
    logger.error('MS redeemFund error:', error.message);
    const status = error.message.includes('sub-account') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

module.exports = { listBonds, getBond, subscribeToBond, listFunds, getFund, subscribeToFund, redeemFund };
