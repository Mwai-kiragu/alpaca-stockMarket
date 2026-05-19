const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class MsOrder extends Model {}

MsOrder.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE'
  },
  order_id: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  symbol: {
    type: DataTypes.STRING(30),
    allowNull: false
  },
  side: {
    type: DataTypes.ENUM('BUY', 'SELL'),
    allowNull: false
  },
  quantity: {
    type: DataTypes.DECIMAL(15, 6),
    allowNull: false
  },
  local_price: {
    type: DataTypes.DECIMAL(15, 6),
    allowNull: true
  },
  usd_price: {
    type: DataTypes.DECIMAL(15, 8),
    allowNull: true
  },
  gross_usd: {
    type: DataTypes.DECIMAL(15, 8),
    allowNull: true
  },
  fee_usd: {
    type: DataTypes.DECIMAL(15, 8),
    allowNull: true
  },
  total_cost_usd: {
    type: DataTypes.DECIMAL(15, 8),
    allowNull: true
  },
  currency: {
    type: DataTypes.STRING(10),
    allowNull: true,
    defaultValue: 'KES'
  },
  status: {
    type: DataTypes.STRING(30),
    allowNull: true,
    defaultValue: 'FILLED'
  },
  exchange: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  wallet_balance_after: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: true
  },
  filled_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: DataTypes.NOW
  }
}, {
  sequelize,
  tableName: 'ms_orders',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['symbol'] },
    { fields: ['user_id', 'symbol'] }
  ]
});

module.exports = MsOrder;
