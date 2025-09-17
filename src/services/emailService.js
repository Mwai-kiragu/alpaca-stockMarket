const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Verify connection configuration
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      this.transporter.verify((error, success) => {
        if (error) {
          logger.error('Email service connection failed:', error);
        } else {
          logger.info('Email service is ready to send messages');
        }
      });
    }
  }

  async sendEmail({ to, subject, html, text }) {
    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        logger.warn('Email credentials not configured. Email not sent.');
        return { success: false, message: 'Email service not configured' };
      }

      const mailOptions = {
        from: `"Trading Platform" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text,
        html
      };

      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Email sent successfully to ${to}:`, info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Failed to send email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendWelcomeEmail(user, verificationToken) {
    const verificationUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;

    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c5aa0;">Welcome to Trading Platform</h1>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #333;">Hello ${user.first_name}!</h2>
          <p style="color: #666; line-height: 1.6;">
            Thank you for joining our trading platform. To get started, please verify your email address by clicking the button below.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}"
             style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Verify Email Address
          </a>
        </div>

        <div style="background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #495057; margin-top: 0;">Next Steps:</h3>
          <ul style="color: #6c757d;">
            <li>Complete KYC verification</li>
            <li>Fund your wallet via M-Pesa</li>
            <li>Start trading US stocks</li>
          </ul>
        </div>

        <div style="border-top: 1px solid #dee2e6; padding-top: 20px; text-align: center; color: #6c757d; font-size: 12px;">
          <p>If you didn't create this account, please ignore this email.</p>
          <p>If the button doesn't work, copy and paste this link: ${verificationUrl}</p>
        </div>
      </div>
    `;

    const text = `
      Welcome to Trading Platform!

      Hello ${user.first_name},

      Thank you for joining our trading platform. Please verify your email address by visiting:
      ${verificationUrl}

      Next steps:
      - Complete KYC verification
      - Fund your wallet via M-Pesa
      - Start trading US stocks

      If you didn't create this account, please ignore this email.
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Welcome to Trading Platform - Verify Your Email',
      html,
      text
    });
  }

  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <h2 style="color: #2c5aa0;">Password Reset Request</h2>

        <p>Hello ${user.first_name},</p>

        <p>You requested to reset your password. Click the button below to reset it:</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}"
             style="background: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
            Reset Password
          </a>
        </div>

        <p style="color: #666;">This link will expire in 1 hour for security reasons.</p>

        <p style="color: #666;">If you didn't request this, please ignore this email.</p>
      </div>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Password Reset - Trading Platform',
      html
    });
  }

  async sendKYCApprovalEmail(user) {
    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <h2 style="color: #28a745;">KYC Verification Approved!</h2>

        <p>Hello ${user.first_name},</p>

        <p>Great news! Your KYC verification has been approved. You can now:</p>

        <ul>
          <li>Fund your wallet via M-Pesa</li>
          <li>Start trading US stocks</li>
          <li>Access all platform features</li>
        </ul>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard"
             style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
            Go to Dashboard
          </a>
        </div>
      </div>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'KYC Verification Approved - Trading Platform',
      html
    });
  }

  async sendTransactionEmail(user, transaction) {
    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <h2 style="color: #2c5aa0;">Transaction Notification</h2>

        <p>Hello ${user.first_name},</p>

        <p>Your transaction has been processed:</p>

        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
          <p><strong>Type:</strong> ${transaction.type}</p>
          <p><strong>Amount:</strong> ${transaction.currency} ${transaction.amount}</p>
          <p><strong>Status:</strong> ${transaction.status}</p>
          <p><strong>Reference:</strong> ${transaction.reference}</p>
        </div>
      </div>
    `;

    return this.sendEmail({
      to: user.email,
      subject: `Transaction ${transaction.status} - Trading Platform`,
      html
    });
  }

  async sendNotificationEmail(user, notification) {
    let html, subject;

    switch (notification.type) {
      case 'order_filled':
        subject = `Order Filled - ${notification.data.symbol}`;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #28a745;">Order Filled Successfully!</h2>
            <p>Hello ${user.first_name},</p>
            <p>Your ${notification.data.side} order has been filled:</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Symbol:</strong> ${notification.data.symbol}</p>
              <p><strong>Quantity:</strong> ${notification.data.quantity} shares</p>
              <p><strong>Price:</strong> $${notification.data.price}</p>
              <p><strong>Total Value:</strong> $${(notification.data.quantity * notification.data.price).toFixed(2)}</p>
              <p><strong>Side:</strong> ${notification.data.side.toUpperCase()}</p>
            </div>
            <p>You can view your updated portfolio in your dashboard.</p>
          </div>
        `;
        break;

      case 'price_alert_triggered':
        subject = `Price Alert Triggered - ${notification.data.symbol}`;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #ffc107;">Price Alert Triggered!</h2>
            <p>Hello ${user.first_name},</p>
            <p>Your price alert has been triggered:</p>
            <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Symbol:</strong> ${notification.data.symbol}</p>
              <p><strong>Alert Condition:</strong> ${notification.data.condition.replace('_', ' ')}</p>
              <p><strong>Target Price:</strong> $${notification.data.targetPrice}</p>
              <p><strong>Current Price:</strong> $${notification.data.currentPrice}</p>
            </div>
            <p>Consider reviewing your trading strategy and taking appropriate action.</p>
          </div>
        `;
        break;

      case 'order_canceled':
        subject = `Order Canceled - ${notification.data.symbol}`;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #6c757d;">Order Canceled</h2>
            <p>Hello ${user.first_name},</p>
            <p>Your order has been canceled:</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Symbol:</strong> ${notification.data.symbol}</p>
              <p><strong>Quantity:</strong> ${notification.data.quantity} shares</p>
              <p><strong>Side:</strong> ${notification.data.side.toUpperCase()}</p>
            </div>
            <p>Your funds have been unfrozen and are available for trading.</p>
          </div>
        `;
        break;

      case 'margin_call':
        subject = 'Margin Call Warning - Immediate Action Required';
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #dc3545;">Margin Call Warning</h2>
            <p>Hello ${user.first_name},</p>
            <p><strong>Immediate attention required!</strong></p>
            <p>Your account is approaching margin requirements:</p>
            <div style="background: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545;">
              <p><strong>Current Equity:</strong> $${notification.data.equity.toFixed(2)}</p>
              <p><strong>Maintenance Margin:</strong> $${notification.data.maintenanceMargin.toFixed(2)}</p>
            </div>
            <p>Please deposit funds or close positions to meet margin requirements.</p>
          </div>
        `;
        break;

      default:
        subject = notification.title;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #2c5aa0;">${notification.title}</h2>
            <p>Hello ${user.first_name},</p>
            <p>${notification.message}</p>
          </div>
        `;
    }

    return this.sendEmail({
      to: user.email,
      subject,
      html
    });
  }

  async sendPortfolioSummaryEmail(user, portfolioData) {
    const isGain = portfolioData.dayChangePercent >= 0;
    const changeColor = isGain ? '#28a745' : '#dc3545';
    const changeSymbol = isGain ? '+' : '';

    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <h2 style="color: #2c5aa0;">Daily Portfolio Summary</h2>

        <p>Hello ${user.first_name},</p>

        <p>Here's your portfolio summary for today:</p>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
            <div>
              <h3 style="margin: 0; color: #495057;">Total Portfolio Value</h3>
              <p style="font-size: 24px; margin: 5px 0; font-weight: bold;">$${portfolioData.totalEquity.toFixed(2)}</p>
              <p style="color: ${changeColor}; margin: 0;">
                ${changeSymbol}$${Math.abs(portfolioData.dayChange).toFixed(2)} (${changeSymbol}${portfolioData.dayChangePercent.toFixed(2)}%)
              </p>
            </div>
          </div>

          <hr style="border: 1px solid #dee2e6;">

          <div style="margin-top: 15px;">
            <p><strong>Cash Available:</strong> $${portfolioData.cash.toFixed(2)}</p>
            <p><strong>Buying Power:</strong> $${portfolioData.buyingPower.toFixed(2)}</p>
            <p><strong>Positions:</strong> ${portfolioData.positionsCount}</p>
          </div>
        </div>

        ${portfolioData.topPositions && portfolioData.topPositions.length > 0 ? `
        <div style="margin: 20px 0;">
          <h4>Top Positions:</h4>
          ${portfolioData.topPositions.map(position => `
            <div style="background: white; border: 1px solid #dee2e6; padding: 10px; margin: 5px 0; border-radius: 4px;">
              <strong>${position.symbol}</strong> - ${position.quantity} shares @ $${position.currentPrice.toFixed(2)}
              <span style="color: ${position.unrealizedPL >= 0 ? '#28a745' : '#dc3545'}; float: right;">
                ${position.unrealizedPL >= 0 ? '+' : ''}$${position.unrealizedPL.toFixed(2)}
              </span>
            </div>
          `).join('')}
        </div>
        ` : ''}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/portfolio"
             style="background: #2c5aa0; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
            View Full Portfolio
          </a>
        </div>
      </div>
    `;

    return this.sendEmail({
      to: user.email,
      subject: `Portfolio Summary - ${isGain ? 'Up' : 'Down'} ${Math.abs(portfolioData.dayChangePercent).toFixed(2)}% Today`,
      html
    });
  }

  async sendSupportTicketEmail(user, ticketData) {
    let html, subject;

    switch (ticketData.status) {
      case 'created':
        subject = `Support Ticket Created - ${ticketData.ticketId}`;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #2c5aa0;">Support Ticket Created</h2>
            <p>Hello ${user.first_name},</p>
            <p>Your support ticket has been created successfully. We'll respond within our estimated timeframe.</p>

            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Ticket ID:</strong> ${ticketData.ticketId}</p>
              <p><strong>Subject:</strong> ${ticketData.subject}</p>
              <p><strong>Category:</strong> ${ticketData.category.replace('_', ' ').toUpperCase()}</p>
              <p><strong>Priority:</strong> ${ticketData.priority.toUpperCase()}</p>
            </div>

            <p>You can track your ticket status and add messages by visiting your support dashboard.</p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/support/tickets/${ticketData.ticketId}"
                 style="background: #2c5aa0; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
                View Ticket
              </a>
            </div>
          </div>
        `;
        break;

      case 'reply_added':
        subject = `New Reply - ${ticketData.ticketId}`;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #2c5aa0;">New Message on Support Ticket</h2>
            <p>Hello ${user.first_name},</p>
            <p>A new message has been added to your support ticket.</p>

            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Ticket ID:</strong> ${ticketData.ticketId}</p>
              <p><strong>Subject:</strong> ${ticketData.subject}</p>
              <p><strong>Message:</strong></p>
              <div style="background: white; padding: 10px; border-radius: 3px; margin-top: 5px;">
                ${ticketData.message}
              </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/support/tickets/${ticketData.ticketId}"
                 style="background: #2c5aa0; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
                View & Reply
              </a>
            </div>
          </div>
        `;
        break;

      case 'resolved':
        subject = `Support Ticket Resolved - ${ticketData.ticketId}`;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #28a745;">Support Ticket Resolved</h2>
            <p>Hello ${user.first_name},</p>
            <p>Great news! Your support ticket has been resolved.</p>

            <div style="background: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Ticket ID:</strong> ${ticketData.ticketId}</p>
              <p><strong>Subject:</strong> ${ticketData.subject}</p>
              <p><strong>Resolution:</strong> ${ticketData.resolutionNotes || 'Issue has been resolved'}</p>
            </div>

            <p>If you're satisfied with the resolution, you can close this ticket. If you need further assistance, feel free to reopen it or add a message.</p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/support/tickets/${ticketData.ticketId}"
                 style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
                View Resolution
              </a>
            </div>
          </div>
        `;
        break;

      case 'reopened':
        subject = `Support Ticket Reopened - ${ticketData.ticketId}`;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #ffc107;">Support Ticket Reopened</h2>
            <p>Hello ${user.first_name},</p>
            <p>Your support ticket has been reopened and our team will review it shortly.</p>

            <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Ticket ID:</strong> ${ticketData.ticketId}</p>
              <p><strong>Subject:</strong> ${ticketData.subject}</p>
              <p><strong>Reason:</strong> ${ticketData.message}</p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/support/tickets/${ticketData.ticketId}"
                 style="background: #ffc107; color: black; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
                View Ticket
              </a>
            </div>
          </div>
        `;
        break;

      default:
        subject = `Support Update - ${ticketData.ticketId}`;
        html = `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <h2 style="color: #2c5aa0;">Support Ticket Update</h2>
            <p>Hello ${user.first_name},</p>
            <p>There's an update on your support ticket.</p>

            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Ticket ID:</strong> ${ticketData.ticketId}</p>
              <p><strong>Subject:</strong> ${ticketData.subject}</p>
            </div>
          </div>
        `;
    }

    return this.sendEmail({
      to: user.email,
      subject,
      html
    });
  }
}

module.exports = new EmailService();