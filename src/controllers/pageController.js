const StaticPage = require('../models/StaticPage');
const logger = require('../utils/logger');

const VALID_SLUGS = ['our-investors', 'partner-with-us', 'faqs', 'privacy-policy', 'terms-of-service', 'disclosure-agreement', 'market-disclosures'];

const get = async (req, res) => {
  try {
    const { slug } = req.params;
    if (!VALID_SLUGS.includes(slug)) return res.status(404).json({ success: false, message: 'Page not found.' });

    const page = await StaticPage.findOne({ where: { slug } });
    res.json({ success: true, data: page || { slug, content: '' } });
  } catch (error) {
    logger.error('Page get error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const upsert = async (req, res) => {
  try {
    const { slug } = req.params;
    if (!VALID_SLUGS.includes(slug)) return res.status(404).json({ success: false, message: 'Page not found.' });

    const { content } = req.body;
    const [page] = await StaticPage.upsert({ slug, content }, { returning: true });

    logger.info(`Static page updated: ${slug}`);
    res.json({ success: true, data: page });
  } catch (error) {
    logger.error('Page upsert error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { get, upsert };
