const { User } = require('../models');
const logger = require('../utils/logger');

const adminController = {
  // Get all pending KYC applications
  getPendingKYC: async (req, res) => {
    try {
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      const users = await User.findAndCountAll({
        where: {
          kyc_status: ['submitted', 'pending', 'under_review']
        },
        attributes: {
          exclude: ['password', 'pin_hash']
        },
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      res.json({
        success: true,
        data: {
          users: users.rows,
          pagination: {
            total: users.count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(users.count / limit)
          }
        }
      });

    } catch (error) {
      logger.error('Get pending KYC error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch pending KYC applications'
      });
    }
  },

  // Get KYC details for a specific user
  getKYCDetails: async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await User.findByPk(userId, {
        attributes: {
          exclude: ['password', 'pin_hash']
        }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            fullName: `${user.first_name} ${user.last_name}`,
            email: user.email,
            phone: user.phone,
            dateOfBirth: user.date_of_birth,
            address: user.address,
            kycStatus: user.kyc_status,
            kycData: user.kyc_data,
            registrationStatus: user.registration_status,
            createdAt: user.createdAt,
            alpacaAccountId: user.alpaca_account_id
          }
        }
      });

    } catch (error) {
      logger.error('Get KYC details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch KYC details'
      });
    }
  },

  // Approve KYC application
  approveKYC: async (req, res) => {
    try {
      const { userId } = req.params;
      const { comments, reviewedBy } = req.body;

      const user = await User.findByPk(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!['submitted', 'pending', 'under_review'].includes(user.kyc_status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot approve KYC with status: ${user.kyc_status}`
        });
      }

      // Update KYC data with approval info
      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        kycApproval: {
          status: 'approved',
          approvedBy: reviewedBy || req.user?.id || 'admin',
          approvedAt: new Date(),
          comments: comments || 'KYC documents verified and approved',
          reviewNotes: req.body.reviewNotes
        }
      };

      await user.update({
        kyc_status: 'approved',
        kyc_data: updatedKycData,
        account_status: 'active'
      });

      logger.info(`KYC approved for user: ${user.email} by ${reviewedBy || 'admin'}`);

      // Send approval notification (implement email/SMS service)
      try {
        const notificationService = require('../services/notificationService');
        await notificationService.sendKYCApprovalNotification(user.id);
      } catch (notificationError) {
        logger.warn('Failed to send KYC approval notification:', notificationError);
      }

      res.json({
        success: true,
        message: 'KYC application approved successfully',
        data: {
          userId: user.id,
          kycStatus: user.kyc_status,
          approvedAt: new Date()
        }
      });

    } catch (error) {
      logger.error('Approve KYC error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to approve KYC application'
      });
    }
  },

  // Reject KYC application
  rejectKYC: async (req, res) => {
    try {
      const { userId } = req.params;
      const { reason, comments, reviewedBy } = req.body;

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required'
        });
      }

      const user = await User.findByPk(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!['submitted', 'pending', 'under_review'].includes(user.kyc_status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot reject KYC with status: ${user.kyc_status}`
        });
      }

      // Update KYC data with rejection info
      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        kycRejection: {
          status: 'rejected',
          rejectedBy: reviewedBy || req.user?.id || 'admin',
          rejectedAt: new Date(),
          reason,
          comments: comments || '',
          reviewNotes: req.body.reviewNotes
        }
      };

      await user.update({
        kyc_status: 'rejected',
        kyc_data: updatedKycData,
        account_status: 'pending'
      });

      logger.info(`KYC rejected for user: ${user.email} by ${reviewedBy || 'admin'}, reason: ${reason}`);

      // Send rejection notification
      try {
        const notificationService = require('../services/notificationService');
        await notificationService.sendKYCRejectionNotification(user.id, reason, comments);
      } catch (notificationError) {
        logger.warn('Failed to send KYC rejection notification:', notificationError);
      }

      res.json({
        success: true,
        message: 'KYC application rejected',
        data: {
          userId: user.id,
          kycStatus: user.kyc_status,
          rejectedAt: new Date(),
          reason
        }
      });

    } catch (error) {
      logger.error('Reject KYC error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reject KYC application'
      });
    }
  },

  // Sync KYC status from Alpaca
  syncKYCFromAlpaca: async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await User.findByPk(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!user.alpaca_account_id) {
        return res.status(400).json({
          success: false,
          message: 'User does not have an Alpaca account'
        });
      }

      // Get status from Alpaca
      const alpacaService = require('../services/alpacaService');
      const alpacaStatus = await alpacaService.getAccountStatus(user.alpaca_account_id);

      // Update user's KYC status based on Alpaca
      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        alpacaSync: {
          lastSynced: new Date(),
          alpacaStatus: alpacaStatus.status,
          alpacaAccountId: alpacaStatus.accountId,
          tradingEnabled: alpacaStatus.tradingEnabled,
          syncedBy: req.user?.id || 'system'
        }
      };

      await user.update({
        kyc_status: alpacaStatus.kycStatus,
        kyc_data: updatedKycData,
        account_status: alpacaStatus.tradingEnabled ? 'active' : 'pending'
      });

      logger.info(`KYC status synced from Alpaca for user: ${user.email}, status: ${alpacaStatus.kycStatus}`);

      res.json({
        success: true,
        message: 'KYC status synchronized with Alpaca successfully',
        data: {
          userId: user.id,
          oldKycStatus: user.kyc_status,
          newKycStatus: alpacaStatus.kycStatus,
          alpacaStatus: alpacaStatus.status,
          tradingEnabled: alpacaStatus.tradingEnabled,
          syncedAt: new Date()
        }
      });

    } catch (error) {
      logger.error('Sync KYC from Alpaca error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to sync KYC status from Alpaca',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Sync failed'
      });
    }
  },

  // Bulk sync all users with Alpaca accounts
  bulkSyncKYCFromAlpaca: async (req, res) => {
    try {
      const { limit = 50 } = req.query;

      // Get users with Alpaca accounts
      const users = await User.findAll({
        where: {
          alpaca_account_id: {
            [require('sequelize').Op.ne]: null
          }
        },
        limit: parseInt(limit),
        order: [['updatedAt', 'DESC']]
      });

      if (users.length === 0) {
        return res.json({
          success: true,
          message: 'No users with Alpaca accounts found',
          data: { syncedCount: 0 }
        });
      }

      const alpacaService = require('../services/alpacaService');
      const accountIds = users.map(u => u.alpaca_account_id);

      // Get status from Alpaca for all accounts
      const alpacaStatuses = await alpacaService.getAccountStatuses(accountIds);

      let syncedCount = 0;
      const results = [];

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const alpacaStatus = alpacaStatuses[i];

        if (!alpacaStatus.error) {
          try {
            const currentKycData = user.kyc_data || {};
            const updatedKycData = {
              ...currentKycData,
              alpacaSync: {
                lastSynced: new Date(),
                alpacaStatus: alpacaStatus.status,
                alpacaAccountId: alpacaStatus.accountId,
                tradingEnabled: alpacaStatus.tradingEnabled,
                syncedBy: req.user?.id || 'system'
              }
            };

            await user.update({
              kyc_status: alpacaStatus.kycStatus,
              kyc_data: updatedKycData,
              account_status: alpacaStatus.tradingEnabled ? 'active' : 'pending'
            });

            syncedCount++;
            results.push({
              userId: user.id,
              email: user.email,
              oldStatus: user.kyc_status,
              newStatus: alpacaStatus.kycStatus,
              success: true
            });
          } catch (updateError) {
            results.push({
              userId: user.id,
              email: user.email,
              error: updateError.message,
              success: false
            });
          }
        } else {
          results.push({
            userId: user.id,
            email: user.email,
            error: alpacaStatus.error,
            success: false
          });
        }
      }

      logger.info(`Bulk KYC sync completed: ${syncedCount}/${users.length} users synchronized`);

      res.json({
        success: true,
        message: `Successfully synchronized ${syncedCount} out of ${users.length} users`,
        data: {
          syncedCount,
          totalUsers: users.length,
          results
        }
      });

    } catch (error) {
      logger.error('Bulk sync KYC from Alpaca error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to perform bulk KYC sync',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Bulk sync failed'
      });
    }
  },

  // Request additional KYC information
  requestKYCInfo: async (req, res) => {
    try {
      const { userId } = req.params;
      const { requestedInfo, comments, reviewedBy } = req.body;

      if (!requestedInfo || requestedInfo.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Requested information list is required'
        });
      }

      const user = await User.findByPk(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update KYC data with info request
      const currentKycData = user.kyc_data || {};
      const updatedKycData = {
        ...currentKycData,
        kycInfoRequest: {
          requestedBy: reviewedBy || req.user?.id || 'admin',
          requestedAt: new Date(),
          requestedInfo,
          comments: comments || '',
          status: 'info_requested'
        }
      };

      await user.update({
        kyc_status: 'under_review',
        kyc_data: updatedKycData
      });

      logger.info(`Additional KYC info requested for user: ${user.email}`);

      // Send info request notification
      try {
        const notificationService = require('../services/notificationService');
        await notificationService.sendKYCInfoRequestNotification(user.id, requestedInfo, comments);
      } catch (notificationError) {
        logger.warn('Failed to send KYC info request notification:', notificationError);
      }

      res.json({
        success: true,
        message: 'Additional KYC information requested',
        data: {
          userId: user.id,
          kycStatus: user.kyc_status,
          requestedInfo
        }
      });

    } catch (error) {
      logger.error('Request KYC info error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to request additional KYC information'
      });
    }
  }
};

module.exports = adminController;