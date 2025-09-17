const { Notification, User } = require('../models');
const emailService = require('../services/emailService');
const alpacaService = require('../services/alpacaService');
const exchangeService = require('../services/exchangeService');
const logger = require('../utils/logger');

const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, read, priority } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { user_id: req.user.id };
    if (type) whereClause.type = type;
    if (read !== undefined) whereClause.is_read = read === 'true';
    if (priority) whereClause.priority = priority;

    const { count, rows: notifications } = await Notification.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      notifications: notifications.map(notification => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        isRead: notification.is_read,
        metadata: notification.metadata,
        actionUrl: notification.action_url,
        createdAt: notification.created_at,
        readAt: notification.read_at
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      },
      summary: {
        total: count,
        unread: await Notification.count({
          where: { user_id: req.user.id, is_read: false }
        }),
        highPriority: await Notification.count({
          where: { user_id: req.user.id, priority: 'high', is_read: false }
        })
      }
    });
  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findOne({
      where: {
        id: notificationId,
        user_id: req.user.id
      }
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.update({
      is_read: true,
      read_at: new Date()
    });

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    logger.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    await Notification.update(
      {
        is_read: true,
        read_at: new Date()
      },
      {
        where: {
          user_id: req.user.id,
          is_read: false
        }
      }
    );

    const unreadCount = await Notification.count({
      where: { user_id: req.user.id, is_read: false }
    });

    res.json({
      success: true,
      message: 'All notifications marked as read',
      unreadCount
    });
  } catch (error) {
    logger.error('Mark all notifications as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findOne({
      where: {
        id: notificationId,
        user_id: req.user.id
      }
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.destroy();

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    logger.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
};

const createPriceAlert = async (req, res) => {
  try {
    const { symbol, condition, targetPrice, notificationMethod = 'both' } = req.body;

    if (!symbol || !condition || !targetPrice) {
      return res.status(400).json({
        success: false,
        message: 'Symbol, condition, and targetPrice are required'
      });
    }

    if (!['above', 'below', 'crosses_up', 'crosses_down'].includes(condition)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid condition. Must be: above, below, crosses_up, or crosses_down'
      });
    }

    // Verify symbol exists and get current price
    try {
      const asset = await alpacaService.getAsset(symbol.toUpperCase());
      const quote = await alpacaService.getLatestQuote(symbol.toUpperCase());
      const currentPrice = quote.ap || quote.bp;

      const notification = await Notification.create({
        user_id: req.user.id,
        type: 'price_alert',
        title: `Price Alert for ${symbol.toUpperCase()}`,
        message: `Alert when ${symbol.toUpperCase()} ${condition.replace('_', ' ')} $${targetPrice}`,
        priority: 'medium',
        is_read: false,
        metadata: {
          symbol: symbol.toUpperCase(),
          condition,
          targetPrice: parseFloat(targetPrice),
          currentPrice,
          notificationMethod,
          active: true,
          assetName: asset.name
        }
      });

      logger.info('Price alert created:', {
        userId: req.user.id,
        symbol: symbol.toUpperCase(),
        condition,
        targetPrice,
        currentPrice
      });

      res.status(201).json({
        success: true,
        message: 'Price alert created successfully',
        alert: {
          id: notification.id,
          symbol: symbol.toUpperCase(),
          condition,
          targetPrice: parseFloat(targetPrice),
          currentPrice,
          status: 'active'
        }
      });
    } catch (symbolError) {
      return res.status(404).json({
        success: false,
        message: 'Invalid symbol or symbol not found'
      });
    }
  } catch (error) {
    logger.error('Create price alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create price alert'
    });
  }
};

const getPriceAlerts = async (req, res) => {
  try {
    const { active, symbol } = req.query;

    const whereClause = {
      user_id: req.user.id,
      type: 'price_alert'
    };

    if (active !== undefined) {
      whereClause['metadata.active'] = active === 'true';
    }

    if (symbol) {
      whereClause['metadata.symbol'] = symbol.toUpperCase();
    }

    const alerts = await Notification.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']]
    });

    const formattedAlerts = await Promise.all(
      alerts.map(async (alert) => {
        const metadata = alert.metadata;
        let currentPrice = metadata.currentPrice;
        let priceChange = 0;
        let changePercent = 0;

        // Get current price for active alerts
        if (metadata.active) {
          try {
            const quote = await alpacaService.getLatestQuote(metadata.symbol);
            currentPrice = quote.ap || quote.bp;
            priceChange = currentPrice - metadata.currentPrice;
            changePercent = (priceChange / metadata.currentPrice) * 100;
          } catch (priceError) {
            logger.warn(`Failed to get current price for ${metadata.symbol}:`, priceError);
          }
        }

        const distanceToTarget = Math.abs(currentPrice - metadata.targetPrice);
        const distancePercent = (distanceToTarget / currentPrice) * 100;

        return {
          id: alert.id,
          symbol: metadata.symbol,
          assetName: metadata.assetName,
          condition: metadata.condition,
          targetPrice: metadata.targetPrice,
          currentPrice,
          priceChange: parseFloat(priceChange.toFixed(2)),
          changePercent: parseFloat(changePercent.toFixed(2)),
          distanceToTarget: parseFloat(distanceToTarget.toFixed(2)),
          distancePercent: parseFloat(distancePercent.toFixed(2)),
          active: metadata.active,
          notificationMethod: metadata.notificationMethod,
          createdAt: alert.created_at,
          triggered: alert.is_read && metadata.active === false
        };
      })
    );

    res.json({
      success: true,
      alerts: formattedAlerts,
      count: formattedAlerts.length,
      summary: {
        total: formattedAlerts.length,
        active: formattedAlerts.filter(a => a.active).length,
        triggered: formattedAlerts.filter(a => a.triggered).length
      }
    });
  } catch (error) {
    logger.error('Get price alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch price alerts'
    });
  }
};

const updatePriceAlert = async (req, res) => {
  try {
    const { alertId } = req.params;
    const { targetPrice, condition, active, notificationMethod } = req.body;

    const alert = await Notification.findOne({
      where: {
        id: alertId,
        user_id: req.user.id,
        type: 'price_alert'
      }
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Price alert not found'
      });
    }

    const updates = { ...alert.metadata };
    let messageUpdated = false;

    if (targetPrice !== undefined) {
      updates.targetPrice = parseFloat(targetPrice);
      messageUpdated = true;
    }

    if (condition !== undefined) {
      if (!['above', 'below', 'crosses_up', 'crosses_down'].includes(condition)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid condition'
        });
      }
      updates.condition = condition;
      messageUpdated = true;
    }

    if (active !== undefined) {
      updates.active = active;
    }

    if (notificationMethod !== undefined) {
      updates.notificationMethod = notificationMethod;
    }

    const updateData = { metadata: updates };

    if (messageUpdated) {
      updateData.message = `Alert when ${updates.symbol} ${updates.condition.replace('_', ' ')} $${updates.targetPrice}`;
    }

    await alert.update(updateData);

    logger.info('Price alert updated:', {
      userId: req.user.id,
      alertId,
      updates
    });

    res.json({
      success: true,
      message: 'Price alert updated successfully'
    });
  } catch (error) {
    logger.error('Update price alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update price alert'
    });
  }
};

const deletePriceAlert = async (req, res) => {
  try {
    const { alertId } = req.params;

    const alert = await Notification.findOne({
      where: {
        id: alertId,
        user_id: req.user.id,
        type: 'price_alert'
      }
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Price alert not found'
      });
    }

    await alert.destroy();

    logger.info('Price alert deleted:', {
      userId: req.user.id,
      alertId,
      symbol: alert.metadata.symbol
    });

    res.json({
      success: true,
      message: 'Price alert deleted successfully'
    });
  } catch (error) {
    logger.error('Delete price alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete price alert'
    });
  }
};

const getNotificationSettings = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    const settings = user.notification_preferences || {
      email: {
        orderFilled: true,
        orderCanceled: true,
        priceAlerts: true,
        portfolioUpdates: true,
        marketNews: false,
        systemUpdates: true
      },
      push: {
        orderFilled: true,
        orderCanceled: true,
        priceAlerts: true,
        portfolioUpdates: false,
        marketNews: false,
        systemUpdates: false
      },
      inApp: {
        orderFilled: true,
        orderCanceled: true,
        priceAlerts: true,
        portfolioUpdates: true,
        marketNews: true,
        systemUpdates: true
      }
    };

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    logger.error('Get notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification settings'
    });
  }
};

const updateNotificationSettings = async (req, res) => {
  try {
    const settings = req.body;

    const user = await User.findByPk(req.user.id);
    await user.update({
      notification_preferences: settings
    });

    logger.info('Notification settings updated:', {
      userId: req.user.id,
      settings
    });

    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      settings
    });
  } catch (error) {
    logger.error('Update notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification settings'
    });
  }
};

// Helper function to create trading event notifications
const createTradingNotification = async (userId, type, data) => {
  try {
    const exchangeRate = await exchangeService.getExchangeRate('USD', 'KES');

    let title, message, priority = 'medium';

    switch (type) {
      case 'order_filled':
        title = `Order Filled - ${data.symbol}`;
        message = `Your ${data.side} order for ${data.quantity} shares of ${data.symbol} has been filled at $${data.price} ($${(data.quantity * data.price).toFixed(2)} total)`;
        priority = 'high';
        break;
      case 'order_canceled':
        title = `Order Canceled - ${data.symbol}`;
        message = `Your ${data.side} order for ${data.quantity} shares of ${data.symbol} has been canceled`;
        break;
      case 'order_rejected':
        title = `Order Rejected - ${data.symbol}`;
        message = `Your ${data.side} order for ${data.quantity} shares of ${data.symbol} was rejected: ${data.reason}`;
        priority = 'high';
        break;
      case 'price_alert_triggered':
        title = `Price Alert Triggered - ${data.symbol}`;
        message = `${data.symbol} has ${data.condition.replace('_', ' ')} your target price of $${data.targetPrice}. Current price: $${data.currentPrice}`;
        priority = 'high';
        break;
      case 'portfolio_update':
        title = 'Portfolio Update';
        message = `Your portfolio value is now $${data.totalValue.toFixed(2)} (${data.changePercent > 0 ? '+' : ''}${data.changePercent.toFixed(2)}% today)`;
        break;
      case 'margin_call':
        title = 'Margin Call Warning';
        message = `Your account is approaching margin requirements. Current equity: $${data.equity.toFixed(2)}`;
        priority = 'high';
        break;
      case 'account_restricted':
        title = 'Account Restriction';
        message = `Your account has been restricted for ${data.reason}. Contact support for assistance.`;
        priority = 'high';
        break;
      default:
        title = 'Trading Update';
        message = 'You have a new trading update';
    }

    const notification = await Notification.create({
      user_id: userId,
      type,
      title,
      message,
      priority,
      is_read: false,
      metadata: {
        ...data,
        exchangeRate,
        timestamp: new Date().toISOString()
      }
    });

    // Send email if user has email notifications enabled
    const user = await User.findByPk(userId);
    const emailEnabled = user.notification_preferences?.email?.[type] ||
                        user.notification_preferences?.email?.orderFilled;

    if (emailEnabled) {
      await emailService.sendNotificationEmail(user, {
        type,
        title,
        message,
        data
      });
    }

    return notification;
  } catch (error) {
    logger.error('Create trading notification error:', error);
    throw error;
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  createPriceAlert,
  getPriceAlerts,
  updatePriceAlert,
  deletePriceAlert,
  getNotificationSettings,
  updateNotificationSettings,
  createTradingNotification
};