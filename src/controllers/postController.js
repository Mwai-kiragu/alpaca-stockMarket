const { Op } = require('sequelize');
const Post = require('../models/Post');
const logger = require('../utils/logger');

const slugify = (text) =>
  text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const list = async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (type) where.type = type;
    // Public endpoint only sees published; admin sees all
    if (!req.user || req.user.role !== 'admin') where.status = 'published';
    else if (status) where.status = status;

    const { count, rows } = await Post.findAndCountAll({
      where,
      order: [['published_at', 'DESC'], ['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    res.json({ success: true, data: { posts: rows, total: count, page: parseInt(page), pages: Math.ceil(count / parseInt(limit)) } });
  } catch (error) {
    logger.error('Post list error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const get = async (req, res) => {
  try {
    const post = await Post.findOne({ where: { slug: req.params.slug } });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.status !== 'published' && (!req.user || req.user.role !== 'admin')) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    res.json({ success: true, data: post });
  } catch (error) {
    logger.error('Post get error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const create = async (req, res) => {
  try {
    const { type, title, excerpt, content, cover_image_url, author, category, read_time, tags, status } = req.body;
    if (!type || !title) return res.status(400).json({ success: false, message: 'type and title are required.' });

    const slug = slugify(title);
    const existing = await Post.findOne({ where: { slug } });
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    const published_at = status === 'published' ? new Date() : null;
    const post = await Post.create({ type, title, slug: finalSlug, excerpt, content, cover_image_url, author, category, read_time, tags, status, published_at });

    logger.info(`Post created: ${finalSlug}`);
    res.status(201).json({ success: true, data: post });
  } catch (error) {
    logger.error('Post create error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const update = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const { title, excerpt, content, cover_image_url, author, category, read_time, tags, status } = req.body;
    const updates = { excerpt, content, cover_image_url, author, category, read_time, tags, status };
    if (title && title !== post.title) {
      const slug = slugify(title);
      const existing = await Post.findOne({ where: { slug, id: { [Op.ne]: post.id } } });
      updates.title = title;
      updates.slug = existing ? `${slug}-${Date.now()}` : slug;
    }
    if (status === 'published' && post.status !== 'published') updates.published_at = new Date();

    await post.update(updates);
    res.json({ success: true, data: post });
  } catch (error) {
    logger.error('Post update error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const remove = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    await post.destroy();
    res.json({ success: true, message: 'Post deleted.' });
  } catch (error) {
    logger.error('Post delete error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { list, get, create, update, remove };
