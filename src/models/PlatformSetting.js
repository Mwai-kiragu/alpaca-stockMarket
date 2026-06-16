const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PlatformSetting extends Model {}

PlatformSetting.init({
  key: {
    type: DataTypes.STRING(100),
    primaryKey: true,
    allowNull: false,
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  sequelize,
  modelName: 'PlatformSetting',
  tableName: 'platform_settings',
  timestamps: false,
});

module.exports = PlatformSetting;
