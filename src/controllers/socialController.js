const SocialLink = require('../models/SocialLink');
const logger = require('../utils/logger');

const list = async (req, res) => {
  try {
    const links = await SocialLink.findAll({ where: { active: true }, order: [['platform', 'ASC']] });
    res.json({ success: true, data: links });
  } catch (error) {
    logger.error('Social list error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const listAll = async (req, res) => {
  try {
    const links = await SocialLink.findAll({ order: [['platform', 'ASC']] });
    res.json({ success: true, data: links });
  } catch (error) {
    logger.error('Social listAll error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const upsert = async (req, res) => {
  try {
    const { platform } = req.params;
    const { url, active } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'url is required.' });

    const [link] = await SocialLink.upsert({ platform, url, active: active !== false }, { returning: true });
    logger.info(`Social link updated: ${platform}`);
    res.json({ success: true, data: link });
  } catch (error) {
    logger.error('Social upsert error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { list, listAll, upsert };
