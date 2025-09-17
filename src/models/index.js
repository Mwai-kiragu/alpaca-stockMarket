const { sequelize } = require('../config/database');
const User = require('./User');
const { Wallet, Transaction } = require('./Wallet');
const Order = require('./Order');
const Notification = require('./Notification');
const { SupportTicket, SupportTicketMessage } = require('./SupportTicket');
const EmailVerificationToken = require('./EmailVerificationToken');

// Define associations
User.hasOne(Wallet, { foreignKey: 'user_id', as: 'wallet' });
Wallet.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(Order, { foreignKey: 'user_id', as: 'orders' });
Order.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(SupportTicket, { foreignKey: 'user_id', as: 'support_tickets' });
SupportTicket.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

SupportTicket.belongsTo(User, { foreignKey: 'assigned_to', as: 'assigned_user' });

// Support ticket message associations
SupportTicketMessage.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });

// Email verification token associations
User.hasMany(EmailVerificationToken, { foreignKey: 'user_id', as: 'emailTokens' });
EmailVerificationToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

module.exports = {
  sequelize,
  User,
  Wallet,
  Transaction,
  Order,
  Notification,
  SupportTicket,
  SupportTicketMessage,
  EmailVerificationToken
};