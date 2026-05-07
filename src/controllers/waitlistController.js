const { Op } = require('sequelize');
const Waitlist = require('../models/Waitlist');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

const join = async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const existing = await Waitlist.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ success: false, message: "You're already on the waitlist." });
    }

    const entry = await Waitlist.create({ email, name: name || null });

    emailService.sendWaitlistConfirmationEmail(email, name).catch(err =>
      logger.error('Waitlist email failed:', err)
    );

    logger.info(`Waitlist signup: ${email}`);
    res.status(201).json({ success: true, message: "You're on the list! We'll be in touch." });
  } catch (error) {
    logger.error('Waitlist join error:', error);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

const list = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const { count, rows } = await Waitlist.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await Waitlist.count({ where: { createdAt: { [Op.gte]: today } } });

    res.json({
      success: true,
      data: {
        entries: rows,
        total: count,
        todayCount,
        page,
        pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    logger.error('Waitlist list error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const remove = async (req, res) => {
  try {
    const entry = await Waitlist.findByPk(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Entry not found.' });
    }
    await entry.destroy();
    res.json({ success: true, message: 'Entry removed.' });
  } catch (error) {
    logger.error('Waitlist delete error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { join, list, remove };
