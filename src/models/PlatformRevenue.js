const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PlatformRevenue extends Model {}

PlatformRevenue.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('trade_fee', 'deposit_fee', 'withdrawal_fee', 'forex_fee'),
    allowNull: false,
  },
  amount_usd: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: true,
  },
  amount_kes: {
    type: DataTypes.DECIMAL(18, 2),
    allowNull: true,
  },
  currency: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'USD',
  },
  reference: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  sequelize,
  modelName: 'PlatformRevenue',
  tableName: 'platform_revenue',
  timestamps: false,
});

module.exports = PlatformRevenue;
