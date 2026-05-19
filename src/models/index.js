const { sequelize } = require('../config/database');
const User = require('./User');
const { Wallet, Transaction } = require('./Wallet');
const Order = require('./Order');
const Notification = require('./Notification');
const { SupportTicket, SupportTicketMessage } = require('./SupportTicket');
const EmailVerificationToken = require('./EmailVerificationToken');
const PhoneVerificationToken = require('./PhoneVerificationToken');
const PasswordResetToken = require('./PasswordResetToken');
const BiometricAuth = require('./BiometricAuth');
const NotificationPreferences = require('./NotificationPreferences');
const Watchlist = require('./Watchlist');
const WaitlistUser = require('./WaitlistUser');
const Referral = require('./Referral');
const UserReferral = require('./UserReferral');
const Waitlist = require('./Waitlist');
const Post = require('./Post');
const StaticPage = require('./StaticPage');
const SocialLink = require('./SocialLink');
const MsOrder = require('./MsOrder');

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

// Phone verification token associations
User.hasMany(PhoneVerificationToken, { foreignKey: 'user_id', as: 'phoneTokens' });
PhoneVerificationToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Password reset token associations
User.hasMany(PasswordResetToken, { foreignKey: 'user_id', as: 'passwordResetTokens' });
PasswordResetToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Biometric authentication associations
User.hasMany(BiometricAuth, { foreignKey: 'user_id', as: 'biometricAuths' });
BiometricAuth.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Notification preferences associations
User.hasOne(NotificationPreferences, { foreignKey: 'user_id', as: 'notificationPreferences' });
NotificationPreferences.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Watchlist associations (one watchlist per user)
User.hasOne(Watchlist, { foreignKey: 'user_id', as: 'watchlist' });
Watchlist.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// WaitlistUser associations (self-referencing for referrals)
WaitlistUser.belongsTo(WaitlistUser, { foreignKey: 'referred_by', as: 'referrer' });
WaitlistUser.hasMany(WaitlistUser, { foreignKey: 'referred_by', as: 'referrals' });

// Referral associations
WaitlistUser.hasMany(Referral, { foreignKey: 'referrer_user_id', as: 'outgoingReferrals' });
Referral.belongsTo(WaitlistUser, { foreignKey: 'referrer_user_id', as: 'referrer' });
Referral.belongsTo(WaitlistUser, { foreignKey: 'referred_user_id', as: 'referred' });

// User referral associations (self-referencing)
User.belongsTo(User, { foreignKey: 'referred_by', as: 'referrer' });
User.hasMany(User, { foreignKey: 'referred_by', as: 'referredUsers' });

// UserReferral associations
User.hasMany(UserReferral, { foreignKey: 'referrer_id', as: 'outgoingReferrals' });
User.hasOne(UserReferral, { foreignKey: 'referred_id', as: 'incomingReferral' });
UserReferral.belongsTo(User, { foreignKey: 'referrer_id', as: 'referrer' });
UserReferral.belongsTo(User, { foreignKey: 'referred_id', as: 'referred' });

module.exports = {
  sequelize,
  User,
  Wallet,
  Transaction,
  Order,
  Notification,
  SupportTicket,
  SupportTicketMessage,
  EmailVerificationToken,
  PhoneVerificationToken,
  PasswordResetToken,
  BiometricAuth,
  NotificationPreferences,
  Watchlist,
  WaitlistUser,
  Referral,
  UserReferral,
  Waitlist,
  Post,
  StaticPage,
  SocialLink,
  MsOrder,
};