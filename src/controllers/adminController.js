const { User, Transaction, Order, MsOrder } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
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
        msNseTotal, msOtherTotal,
        depositTotal, depositToday,
      ] = await Promise.allSettled([
        User.count(),
        User.count({ where: { createdAt: { [Op.gte]: startOfToday } } }),
        User.findAll({
          attributes: [
            [literal(`TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`), 'date'],
            [fn('COUNT', col('id')), 'count'],
          ],
          where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
          group: [literal(`TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)],
          order: [[literal(`TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`), 'ASC']],
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
            [literal(`TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`), 'date'],
            [fn('COUNT', col('id')), 'count'],
          ],
          where: { createdAt: { [Op.gte]: sevenDaysAgo } },
          group: [literal(`TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)],
          order: [[literal(`TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`), 'ASC']],
          raw: true,
        }),
        MsOrder.findAll({
          attributes: [
            [literal(`TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`), 'date'],
            [fn('COUNT', col('id')), 'count'],
          ],
          where: { created_at: { [Op.gte]: sevenDaysAgo } },
          group: [literal(`TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)],
          order: [[literal(`TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`), 'ASC']],
          raw: true,
        }),
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

      const usCount = val(alpacaOrders30d, 0) || 0;
      const nseCount = val(msNseTotal, 0) || 0;
      const otherCount = val(msOtherTotal, 0) || 0;
      const totalOrders = usCount + nseCount + otherCount || 1;
      const nse = Math.round((nseCount / totalOrders) * 100);
      const us = Math.round((usCount / totalOrders) * 100);
      const marketSplit = {
        nse,
        us,
        other: 100 - nse - us,
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
            totalKes: val(depositTotal, 0) ?? 0,
            todayKes: val(depositToday, 0) ?? 0,
          },
        },
      });
    } catch (error) {
      logger.error('Get analytics error:', error);
      res.status(500).json({ success: false, message: 'Failed to load analytics' });
    }
  },

  listUsers: async (req, res) => {
    try {
      const { page = 1, limit = 20, search, status } = req.query;
      const offset = (page - 1) * limit;
      const { Op } = require('sequelize');

      const where = {};
      if (status === 'deleted') {
        where.is_active = false;
      } else if (status && status !== 'all') {
        where.is_active = true;
        where.status = status;
      } else {
        where.is_active = true;
      }

      if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        where[Op.or] = [
          { first_name: { [Op.iLike]: term } },
          { last_name: { [Op.iLike]: term } },
          { email: { [Op.iLike]: term } },
        ];
      }

      const { count, rows } = await User.findAndCountAll({
        where,
        attributes: { exclude: ['password', 'pin_hash', 'login_attempts', 'lock_until'] },
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

      res.json({
        success: true,
        data: {
          users: rows.map(u => ({
            id: u.id,
            firstName: u.first_name,
            lastName: u.last_name,
            email: u.email,
            phone: u.phone,
            kycStatus: u.kyc_status,
            status: u.status,
            role: u.role,
            isActive: u.is_active,
            createdAt: u.createdAt,
          })),
          pagination: {
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(count / limit),
          },
        },
      });
    } catch (error) {
      logger.error('List users error:', error);
      res.status(500).json({ success: false, message: 'Failed to list users' });
    }
  },

  getUserProfile: async (req, res) => {
    try {
      const { userId } = req.params;
      const { Wallet, Order, MsOrder } = require('../models');

      const user = await User.findByPk(userId, {
        attributes: { exclude: ['password', 'pin_hash', 'login_attempts', 'lock_until'] },
        include: [{ model: Wallet, as: 'wallet' }],
      });

      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const [alpacaOrders, msOrders, orderCount, msOrderCount] = await Promise.all([
        Order.findAll({ where: { user_id: userId }, order: [['createdAt', 'DESC']], limit: 5, raw: true }),
        MsOrder.findAll({ where: { user_id: userId }, order: [['created_at', 'DESC']], limit: 5, raw: true }),
        Order.count({ where: { user_id: userId } }),
        MsOrder.count({ where: { user_id: userId } }),
      ]);

      const recentOrders = [
        ...alpacaOrders.map(o => ({
          symbol: o.symbol,
          side: o.side,
          status: o.status,
          market: 'US',
          createdAt: o.createdAt,
        })),
        ...msOrders.map(o => ({
          symbol: o.symbol,
          side: (o.side || '').toLowerCase(),
          status: o.status,
          market: o.exchange || 'NSE',
          createdAt: o.created_at,
        })),
      ]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            status: user.status,
            kycStatus: user.kyc_status,
            registrationStep: user.registration_step,
            isActive: user.is_active,
            mustChangePassword: user.must_change_password || false,
            createdAt: user.createdAt,
            lastLogin: user.last_login,
            wallet: user.wallet
              ? { kesBalance: parseFloat(user.wallet.kes_balance || 0), usdBalance: parseFloat(user.wallet.usd_balance || 0) }
              : { kesBalance: 0, usdBalance: 0 },
            orderCount: orderCount + msOrderCount,
            recentOrders,
          },
        },
      });
    } catch (error) {
      logger.error('Get user profile error:', error);
      res.status(500).json({ success: false, message: 'Failed to get user profile' });
    }
  },

  suspendUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findByPk(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (!user.is_active) return res.status(400).json({ success: false, message: 'Cannot suspend a deleted user' });
      await user.update({ status: 'suspended' });
      logger.info(`User ${user.email} suspended by admin ${req.user.id}`);
      res.json({ success: true, message: 'User suspended', data: { status: 'suspended' } });
    } catch (error) {
      logger.error('Suspend user error:', error);
      res.status(500).json({ success: false, message: 'Failed to suspend user' });
    }
  },

  activateUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findByPk(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (!user.is_active) return res.status(400).json({ success: false, message: 'Cannot activate a deleted user' });
      await user.update({ status: 'active' });
      logger.info(`User ${user.email} activated by admin ${req.user.id}`);
      res.json({ success: true, message: 'User activated', data: { status: 'active' } });
    } catch (error) {
      logger.error('Activate user error:', error);
      res.status(500).json({ success: false, message: 'Failed to activate user' });
    }
  },

  deleteUser: async (req, res) => {
    try {
      const { userId } = req.params;
      if (userId === req.user.id) return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
      const user = await User.findByPk(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      await user.update({ is_active: false, deleted_at: new Date(), status: 'closed' });
      logger.info(`User ${user.email} soft-deleted by admin ${req.user.id}`);
      res.json({ success: true, message: 'User account deleted' });
    } catch (error) {
      logger.error('Delete user error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
  },

  updateUserRole: async (req, res) => {
    try {
      const { userId } = req.params;
      const { role } = req.body;
      if (!['user', 'support'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Role must be user or support' });
      }
      const user = await User.findByPk(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      await user.update({ role });
      logger.info(`User ${user.email} role changed to ${role} by admin ${req.user.id}`);
      res.json({ success: true, message: `User role updated to ${role}`, data: { role } });
    } catch (error) {
      logger.error('Update user role error:', error);
      res.status(500).json({ success: false, message: 'Failed to update user role' });
    }
  },

  resetUserPassword: async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findByPk(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (!user.is_active) return res.status(400).json({ success: false, message: 'Cannot reset password for deleted user' });

      const crypto = require('crypto');
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = crypto.randomBytes(10);
      let tempPassword = '';
      for (let i = 0; i < 10; i++) {
        tempPassword += chars[bytes[i] % chars.length];
      }

      await user.update({ password: tempPassword, must_change_password: true });

      const emailService = require('../services/emailService');
      await emailService.sendEmail({
        to: user.email,
        subject: 'Your Riven account password has been reset',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2>Password Reset</h2>
            <p>Hi ${user.first_name},</p>
            <p>An admin has reset your Riven account password. Your temporary password is:</p>
            <div style="background:#f5f5f5;border-radius:6px;padding:16px;text-align:center;font-size:24px;font-weight:bold;letter-spacing:4px;margin:20px 0">
              ${tempPassword}
            </div>
            <p>Please log in with this password and you will be prompted to set a new one.</p>
            <p>If you did not request this, contact support immediately.</p>
          </div>
        `,
        text: `Hi ${user.first_name},\n\nYour temporary password is: ${tempPassword}\n\nPlease log in and set a new password.`,
      });

      logger.info(`Password reset for user ${user.email} by admin ${req.user.id}`);
      res.json({ success: true, message: 'Password reset email sent' });
    } catch (error) {
      logger.error('Reset user password error:', error);
      res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
  },

  listOrders: async (req, res) => {
    try {
      const { page = 1, limit = 20, market, status, flagged, search, source } = req.query;
      const { Order, MsOrder, User } = require('../models');

      // Market routing — mirrors ASSET_CATEGORIES in assetController
      const ALPACA_MARKETS = ['us_equity', 'us_etf', 'crypto'];
      const MYSTOCKS_EXCHANGES = ['NSE', 'JSE', 'NGX', 'GSE', 'BRVM', 'LUSE', 'SEM', 'BSE', 'EGX'];

      const shouldQueryAlpaca = source !== 'mystocks' && (!market || market === 'all' || ALPACA_MARKETS.includes(market));
      const shouldQueryMystocks = source !== 'alpaca' && (!market || market === 'all' || MYSTOCKS_EXCHANGES.includes(market));
      const msExchangeFilter = market && MYSTOCKS_EXCHANGES.includes(market) ? market : null;

      // User search: find matching user IDs first
      let searchUserIds = [];
      if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        const matchingUsers = await User.findAll({
          where: {
            [Op.or]: [
              { first_name: { [Op.iLike]: term } },
              { last_name: { [Op.iLike]: term } },
              { email: { [Op.iLike]: term } },
            ]
          },
          attributes: ['id'],
          raw: true,
        });
        searchUserIds = matchingUsers.map(u => u.id);
      }

      const buildWhere = () => {
        const w = {};
        if (search && search.trim()) {
          const term = `%${search.trim()}%`;
          const orClauses = [{ symbol: { [Op.iLike]: term } }];
          if (searchUserIds.length) orClauses.push({ user_id: { [Op.in]: searchUserIds } });
          w[Op.or] = orClauses;
        }
        if (flagged === 'true') w.flagged = true;
        return w;
      };

      const alpacaWhere = { ...buildWhere() };
      if (status && status !== 'all') alpacaWhere.status = status;

      const msWhere = { ...buildWhere() };
      if (status && status !== 'all') msWhere.status = { [Op.iLike]: status };
      if (msExchangeFilter) msWhere.exchange = msExchangeFilter;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const fetchLimit = pageNum * limitNum;

      const queries = [
        shouldQueryAlpaca
          ? Order.findAll({ where: alpacaWhere, include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'email'], required: false }], order: [['createdAt', 'DESC']], limit: fetchLimit })
          : Promise.resolve([]),
        shouldQueryAlpaca ? Order.count({ where: alpacaWhere }) : Promise.resolve(0),
        shouldQueryMystocks
          ? MsOrder.findAll({ where: msWhere, order: [['created_at', 'DESC']], limit: fetchLimit, raw: true })
          : Promise.resolve([]),
        shouldQueryMystocks ? MsOrder.count({ where: msWhere }) : Promise.resolve(0),
        Order.count({ where: { flagged: true } }),
        MsOrder.count({ where: { flagged: true } }),
      ];

      const [alpacaOrders, alpacaTotal, msOrders, msTotal, alpacaFlagged, msFlagged] = await Promise.all(queries);

      // Batch-fetch users for MsOrder results
      const msUserIds = [...new Set(msOrders.map(o => o.user_id))];
      const msUsers = msUserIds.length
        ? await User.findAll({ where: { id: { [Op.in]: msUserIds } }, attributes: ['id', 'first_name', 'last_name', 'email'], raw: true })
        : [];
      const msUserMap = Object.fromEntries(msUsers.map(u => [u.id, u]));

      const normalizeAlpaca = (o) => ({
        id: o.id, source: 'alpaca',
        userId: o.user_id,
        userName: o.user ? `${o.user.first_name} ${o.user.last_name}` : 'Unknown',
        userEmail: o.user ? o.user.email : '',
        symbol: o.symbol, side: o.side, orderType: o.order_type,
        quantity: parseFloat(o.quantity),
        limitPrice: o.limit_price ? parseFloat(o.limit_price) : null,
        averagePrice: o.average_price ? parseFloat(o.average_price) : null,
        status: o.status, market: 'US',
        value: parseFloat(o.order_value), currency: o.currency,
        exchangeRate: o.exchange_rate ? parseFloat(o.exchange_rate) : null,
        brokerId: o.alpaca_order_id,
        flagged: o.flagged || false, flagNote: o.flag_note || null,
        createdAt: o.createdAt,
      });

      const normalizeMystocks = (o) => {
        const user = msUserMap[o.user_id];
        return {
          id: o.id, source: 'mystocks',
          userId: o.user_id,
          userName: user ? `${user.first_name} ${user.last_name}` : 'Unknown',
          userEmail: user ? user.email : '',
          symbol: o.symbol, side: (o.side || '').toLowerCase(), orderType: 'market',
          quantity: parseFloat(o.quantity),
          limitPrice: null,
          averagePrice: o.local_price ? parseFloat(o.local_price) : null,
          status: o.status, market: o.exchange || 'NSE',
          value: o.gross_usd ? parseFloat(o.gross_usd) : 0,
          currency: o.currency || 'KES',
          exchangeRate: null, brokerId: o.order_id || null,
          flagged: o.flagged || false, flagNote: o.flag_note || null,
          createdAt: o.created_at,
        };
      };

      const merged = [
        ...alpacaOrders.map(normalizeAlpaca),
        ...msOrders.map(normalizeMystocks),
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const paginated = merged.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      const total = (alpacaTotal || 0) + (msTotal || 0);

      res.json({
        success: true,
        data: {
          orders: paginated,
          pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
          flaggedCount: (alpacaFlagged || 0) + (msFlagged || 0),
        },
      });
    } catch (error) {
      logger.error('List orders error:', error);
      res.status(500).json({ success: false, message: 'Failed to list orders' });
    }
  },

  cancelOrder: async (req, res) => {
    try {
      const { orderId } = req.params;
      const { source } = req.body;
      const { Order, MsOrder } = require('../models');
      const NON_CANCELLABLE = ['filled', 'cancelled', 'canceled', 'expired', 'rejected', 'FILLED', 'CANCELLED', 'CANCELED'];

      if (source === 'alpaca') {
        const order = await Order.findByPk(orderId);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (NON_CANCELLABLE.includes(order.status))
          return res.status(400).json({ success: false, message: `Cannot cancel order with status: ${order.status}` });
        await order.update({ status: 'cancelled' });
        logger.info(`Order ${orderId} cancelled by admin ${req.user.id}`);
        return res.json({ success: true, message: 'Order cancelled', data: { status: 'cancelled' } });
      }
      if (source === 'mystocks') {
        const order = await MsOrder.findByPk(orderId);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (NON_CANCELLABLE.includes(order.status))
          return res.status(400).json({ success: false, message: `Cannot cancel order with status: ${order.status}` });
        await order.update({ status: 'CANCELLED' });
        logger.info(`MsOrder ${orderId} cancelled by admin ${req.user.id}`);
        return res.json({ success: true, message: 'Order cancelled', data: { status: 'CANCELLED' } });
      }
      return res.status(400).json({ success: false, message: 'source must be alpaca or mystocks' });
    } catch (error) {
      logger.error('Cancel order error:', error);
      res.status(500).json({ success: false, message: 'Failed to cancel order' });
    }
  },

  flagOrder: async (req, res) => {
    try {
      const { orderId } = req.params;
      const { source, note } = req.body;
      const { Order, MsOrder } = require('../models');
      if (!note || !note.trim())
        return res.status(400).json({ success: false, message: 'Flag note is required' });
      const model = source === 'alpaca' ? Order : MsOrder;
      const order = await model.findByPk(orderId);
      if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
      await order.update({ flagged: true, flag_note: note.trim() });
      logger.info(`Order ${orderId} (${source}) flagged by admin ${req.user.id}`);
      res.json({ success: true, message: 'Order flagged', data: { flagged: true, flagNote: note.trim() } });
    } catch (error) {
      logger.error('Flag order error:', error);
      res.status(500).json({ success: false, message: 'Failed to flag order' });
    }
  },

  resolveOrder: async (req, res) => {
    try {
      const { orderId } = req.params;
      const { source } = req.body;
      const { Order, MsOrder } = require('../models');
      const model = source === 'alpaca' ? Order : MsOrder;
      const order = await model.findByPk(orderId);
      if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
      await order.update({ flagged: false, flag_note: null });
      logger.info(`Order ${orderId} (${source}) resolved by admin ${req.user.id}`);
      res.json({ success: true, message: 'Order resolved', data: { flagged: false, flagNote: null } });
    } catch (error) {
      logger.error('Resolve order error:', error);
      res.status(500).json({ success: false, message: 'Failed to resolve order' });
    }
  },
};

module.exports = adminController;