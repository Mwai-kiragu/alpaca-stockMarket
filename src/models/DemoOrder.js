const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class DemoOrder extends Model {}

DemoOrder.init({
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
  price_usd: {
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
    defaultValue: 'USD'
  },
  exchange: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  balance_after: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(30),
    defaultValue: 'FILLED'
  },
  filled_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  sequelize,
  tableName: 'demo_orders',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['user_id', 'symbol'] }
  ]
});

module.exports = DemoOrder;
