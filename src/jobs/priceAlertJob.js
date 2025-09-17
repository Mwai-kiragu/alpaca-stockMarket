const cron = require('node-cron');
const priceAlertService = require('../services/priceAlertService');
const logger = require('../utils/logger');

class PriceAlertJob {
  constructor() {
    this.job = null;
    this.cleanupJob = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Price Alert Job is already running');
      return;
    }

    // Start the price alert service
    priceAlertService.start();

    // Schedule cleanup job - runs daily at 2 AM
    this.cleanupJob = cron.schedule('0 2 * * *', async () => {
      try {
        logger.info('Running daily price alert cleanup...');
        const deletedCount = await priceAlertService.cleanupTriggeredAlerts(30);
        logger.info(`Price alert cleanup completed. Deleted ${deletedCount} old alerts.`);
      } catch (error) {
        logger.error('Price alert cleanup failed:', error);
      }
    }, {
      scheduled: false
    });

    this.cleanupJob.start();
    this.isRunning = true;

    logger.info('Price Alert Job started successfully');
  }

  stop() {
    if (!this.isRunning) {
      logger.warn('Price Alert Job is not running');
      return;
    }

    // Stop the price alert service
    priceAlertService.stop();

    // Stop the cleanup job
    if (this.cleanupJob) {
      this.cleanupJob.stop();
    }

    this.isRunning = false;
    logger.info('Price Alert Job stopped');
  }

  async getStatus() {
    const alertStats = await priceAlertService.getAlertStats();

    return {
      isRunning: this.isRunning,
      serviceStatus: alertStats.serviceStatus,
      statistics: alertStats,
      nextCleanup: this.cleanupJob ? 'Daily at 2:00 AM' : 'Not scheduled'
    };
  }

  // Manual trigger for testing
  async triggerManualCheck() {
    if (!this.isRunning) {
      throw new Error('Price Alert Job is not running');
    }

    logger.info('Manual price alert check triggered');
    await priceAlertService.checkPriceAlerts();
  }

  // Manual cleanup for testing
  async triggerManualCleanup(daysOld = 30) {
    logger.info(`Manual price alert cleanup triggered for alerts older than ${daysOld} days`);
    return await priceAlertService.cleanupTriggeredAlerts(daysOld);
  }
}

module.exports = new PriceAlertJob();