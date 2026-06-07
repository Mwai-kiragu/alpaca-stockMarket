const { User, Transaction, Order, MsOrder } = require('../models');
const { Op, fn, col } = require('sequelize');
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
  },

  getAnalytics: async (req, res) => {
    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const fillDates = (rows, days) => {
        const map = {};
        rows.forEach(r => { map[r.date] = parseInt(r.count); });
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
          const key = d.toISOString().slice(0, 10);
          result.push({ date: key, count: map[key] || 0 });
        }
        return result;
      };

      const [
        totalUsers, todayUsers, registrations30dRaw,
        emailVerified, docsUploaded, kycApproved,
        kycPending, kycRejected, kycUnderReview,
        recentKycActivity,
        alpacaOrders30d, msOrders30d,
        alpacaVolume7dRaw, msVolume7dRaw,
        alpacaTotal, msNseTotal, msOtherTotal,
        depositTotal, depositToday,
      ] = await Promise.allSettled([
        User.count(),
        User.count({ where: { createdAt: { [Op.gte]: startOfToday } } }),
        User.findAll({
          attributes: [
            [fn('DATE', col('"createdAt"')), 'date'],
            [fn('COUNT', col('id')), 'count'],
          ],
          where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
          group: [fn('DATE', col('"createdAt"'))],
          order: [[fn('DATE', col('"createdAt"')), 'ASC']],
          raw: true,
        }),
        User.count({ where: { is_email_verified: true } }),
        User.count({
          where: {
            registration_step: {
              [Op.in]: [
                'documents_id_front', 'documents_id_back', 'documents_proof_address',
                'agreements', 'kyc_pending', 'kyc_under_review', 'completed', 'initial_completed',
              ],
            },
          },
        }),
        User.count({ where: { kyc_status: 'approved' } }),
        User.count({ where: { kyc_status: 'pending' } }),
        User.count({ where: { kyc_status: 'rejected' } }),
        User.count({ where: { kyc_status: 'under_review' } }),
        User.findAll({
          where: { kyc_status: { [Op.in]: ['submitted', 'approved', 'rejected', 'under_review'] } },
          order: [['updatedAt', 'DESC']],
          limit: 5,
          attributes: ['id', 'first_name', 'last_name', 'kyc_status', 'updatedAt'],
          raw: true,
        }),
        Order.count({ where: { createdAt: { [Op.gte]: thirtyDaysAgo } } }),
        MsOrder.count({ where: { created_at: { [Op.gte]: thirtyDaysAgo } } }),
        Order.findAll({
          attributes: [
            [fn('DATE', col('"createdAt"')), 'date'],
            [fn('COUNT', col('id')), 'count'],
          ],
          where: { createdAt: { [Op.gte]: sevenDaysAgo } },
          group: [fn('DATE', col('"createdAt"'))],
          order: [[fn('DATE', col('"createdAt"')), 'ASC']],
          raw: true,
        }),
        MsOrder.findAll({
          attributes: [
            [fn('DATE', col('created_at')), 'date'],
            [fn('COUNT', col('id')), 'count'],
          ],
          where: { created_at: { [Op.gte]: sevenDaysAgo } },
          group: [fn('DATE', col('created_at'))],
          order: [[fn('DATE', col('created_at')), 'ASC']],
          raw: true,
        }),
        Order.count({ where: { createdAt: { [Op.gte]: thirtyDaysAgo } } }),
        MsOrder.count({ where: { exchange: 'NSE', created_at: { [Op.gte]: thirtyDaysAgo } } }),
        MsOrder.count({
          where: { exchange: { [Op.notIn]: ['NSE'] }, created_at: { [Op.gte]: thirtyDaysAgo } },
        }),
        Transaction.sum('amount', {
          where: { type: 'deposit', currency: 'KES', status: 'completed' },
        }),
        Transaction.sum('amount', {
          where: {
            type: 'deposit', currency: 'KES', status: 'completed',
            createdAt: { [Op.gte]: startOfToday },
          },
        }),
      ]);

      const val = (p, fallback = null) => p.status === 'fulfilled' ? p.value : fallback;

      const alpacaVol = val(alpacaVolume7dRaw, []);
      const msVol = val(msVolume7dRaw, []);
      const volMap = {};
      [...alpacaVol, ...msVol].forEach(r => {
        volMap[r.date] = (volMap[r.date] || 0) + parseInt(r.count);
      });
      const volume7d = fillDates(
        Object.entries(volMap).map(([date, count]) => ({ date, count })),
        7
      );

      const usCount = val(alpacaTotal, 0) || 0;
      const nseCount = val(msNseTotal, 0) || 0;
      const otherCount = val(msOtherTotal, 0) || 0;
      const totalOrders = usCount + nseCount + otherCount || 1;
      const marketSplit = {
        nse: Math.round((nseCount / totalOrders) * 100),
        us: Math.round((usCount / totalOrders) * 100),
        other: Math.round((otherCount / totalOrders) * 100),
      };

      res.json({
        success: true,
        data: {
          users: {
            total: val(totalUsers, 0),
            todayCount: val(todayUsers, 0),
            registrations30d: fillDates(val(registrations30dRaw, []), 30),
          },
          funnel: {
            registered: val(totalUsers, 0),
            emailVerified: val(emailVerified, 0),
            docsUploaded: val(docsUploaded, 0),
            kycApproved: val(kycApproved, 0),
          },
          kyc: {
            pending: val(kycPending, 0),
            approved: val(kycApproved, 0),
            rejected: val(kycRejected, 0),
            underReview: val(kycUnderReview, 0),
            recentActivity: (val(recentKycActivity, [])).map(u => ({
              userId: u.id,
              fullName: `${u.first_name} ${u.last_name}`,
              kycStatus: u.kyc_status,
              updatedAt: u.updatedAt,
            })),
          },
          trading: {
            activeTraders30d: null,
            orders30d: (val(alpacaOrders30d, 0) || 0) + (val(msOrders30d, 0) || 0),
            volume7d,
            marketSplit,
          },
          deposits: {
            totalKes: val(depositTotal, null),
            todayKes: val(depositToday, null),
          },
        },
      });
    } catch (error) {
      logger.error('Get analytics error:', error);
      res.status(500).json({ success: false, message: 'Failed to load analytics' });
    }
  },
};

module.exports = adminController;