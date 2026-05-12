const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SocialLink extends Model {}

SocialLink.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  platform: {
    type: DataTypes.ENUM('facebook', 'twitter', 'instagram', 'linkedin', 'youtube', 'tiktok'),
    allowNull: false,
    unique: true,
  },
  url: { type: DataTypes.STRING(1000), allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  sequelize,
  modelName: 'SocialLink',
  tableName: 'social_links',
});

module.exports = SocialLink;
