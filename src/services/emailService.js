const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'mail.rivenapp.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false // Accept self-signed certificates
      },
      connectionTimeout: 10000, // 10 seconds
      socketTimeout: 10000, // 10 seconds
    });

    // Verify connection configuration
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
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
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        logger.warn('SMTP credentials not configured. Email not sent.');
        return { success: false, message: 'Email service not configured' };
      }

      const mailOptions = {
        from: `"Trading Platform" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
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

  async sendVerificationCodeEmail(user, verificationCode) {
    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c5aa0;">Welcome to Trading Platform</h1>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #333;">Hello ${user.first_name}!</h2>
          <p style="color: #666; line-height: 1.6;">
            Thank you for joining our trading platform. To get started, please verify your email address using the verification code below.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0; background: #e3f2fd; padding: 30px; border-radius: 10px;">
          <p style="color: #1976d2; font-size: 18px; margin-bottom: 10px; font-weight: bold;">Your verification code is:</p>
          <div style="background: #1976d2; color: white; padding: 20px; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 4px; font-family: 'Courier New', monospace;">
            ${verificationCode}
          </div>
          <p style="color: #666; font-size: 14px; margin-top: 15px;">
            This code will expire in 15 minutes for security purposes.
          </p>
        </div>

        <div style="background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #495057; margin-top: 0;">Next Steps After Verification:</h3>
          <ul style="color: #6c757d;">
            <li>Complete your personal information</li>
            <li>Verify your phone number</li>
            <li>Complete KYC verification</li>
            <li>Fund your wallet via M-Pesa</li>
            <li>Start trading US stocks</li>
          </ul>
        </div>

        <div style="border-top: 1px solid #dee2e6; padding-top: 20px; text-align: center; color: #6c757d; font-size: 12px;">
          <p>If you didn't create this account, please ignore this email.</p>
          <p>For security reasons, never share this verification code with anyone.</p>
        </div>
      </div>
    `;

    const text = `
      Welcome to Trading Platform!

      Hello ${user.first_name},

      Thank you for joining our trading platform. Please verify your email address using the verification code below:

      Verification Code: ${verificationCode}

      This code will expire in 15 minutes for security purposes.

      Next steps after verification:
      - Complete your personal information
      - Verify your phone number
      - Complete KYC verification
      - Fund your wallet via M-Pesa
      - Start trading US stocks

      If you didn't create this account, please ignore this email.
      For security reasons, never share this verification code with anyone.
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Email Verification Code - Trading Platform',
      html,
      text
    });
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

  async sendOnboardingCompleteEmail(user, alpacaAccountCreated = false) {
    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #28a745;">🎉 Welcome to Riven Trading!</h1>
        </div>

        <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #28a745;">
          <h2 style="color: #155724; margin-top: 0;">Onboarding Complete!</h2>
          <p style="color: #155724; line-height: 1.6; margin-bottom: 0;">
            Congratulations ${user.first_name}! You have successfully completed your onboarding process.
          </p>
        </div>

        ${alpacaAccountCreated ? `
        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #1976d2; margin-top: 0;">🚀 Your Trading Account is Ready!</h3>
          <p style="color: #1976d2; line-height: 1.6;">
            Your Alpaca trading account has been successfully created and is ready for use. You can now start trading US stocks immediately.
          </p>
        </div>
        ` : `
        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #856404; margin-top: 0;">⏳ Trading Account Setup in Progress</h3>
          <p style="color: #856404; line-height: 1.6;">
            Your trading account is being set up. You'll receive another email once it's ready for trading.
          </p>
        </div>
        `}

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #495057; margin-top: 0;">What's Next?</h3>
          <ul style="color: #6c757d; line-height: 1.8; padding-left: 20px;">
            ${alpacaAccountCreated ? `
            <li>🏦 <strong>Fund Your Account</strong> - Add money via M-Pesa to start trading</li>
            <li>📈 <strong>Explore Markets</strong> - Browse and research US stocks</li>
            <li>💼 <strong>Build Your Portfolio</strong> - Start investing in your favorite companies</li>
            <li>📱 <strong>Set Price Alerts</strong> - Stay updated on stock movements</li>
            ` : `
            <li>⏳ <strong>Wait for Account Activation</strong> - We'll notify you when your trading account is ready</li>
            <li>📚 <strong>Learn About Trading</strong> - Explore our educational resources</li>
            <li>📱 <strong>Explore the App</strong> - Familiarize yourself with the platform</li>
            <li>🔔 <strong>Enable Notifications</strong> - Stay updated on your account status</li>
            `}
          </ul>
        </div>

        <div style="background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h4 style="color: #495057; margin-top: 0;">Welcome Bonus! 🎁</h4>
          <p style="color: #6c757d; margin-bottom: 10px;">
            As a welcome gift, we've credited your account with <strong>$10 USD</strong> to help you get started!
          </p>
          <p style="color: #6c757d; margin-bottom: 0; font-size: 12px;">
            *Terms and conditions apply. Bonus funds available for trading after account funding.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || 'http://134.209.217.111'}/dashboard"
             style="background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            Go to Dashboard
          </a>
        </div>

        <div style="border-top: 1px solid #dee2e6; padding-top: 20px; text-align: center; color: #6c757d; font-size: 12px;">
          <p>Need help? Contact our support team anytime.</p>
          <p>Thank you for choosing Riven Trading Platform!</p>
        </div>
      </div>
    `;

    const text = `
      🎉 Welcome to Riven Trading!

      Hello ${user.first_name},

      Congratulations! You have successfully completed your onboarding process.

      ${alpacaAccountCreated ?
        '🚀 Your trading account is ready! You can now start trading US stocks immediately.' :
        '⏳ Your trading account is being set up. You\'ll receive another email once it\'s ready for trading.'
      }

      What's Next:
      ${alpacaAccountCreated ? `
      - Fund your account via M-Pesa to start trading
      - Explore and research US stocks
      - Build your investment portfolio
      - Set price alerts for your favorite stocks
      ` : `
      - Wait for account activation notification
      - Learn about trading with our educational resources
      - Explore the platform features
      - Enable notifications for account updates
      `}

      Welcome Bonus: $10 USD credited to your account! 🎁

      Visit your dashboard: ${process.env.CLIENT_URL || 'http://134.209.217.111'}/dashboard

      Thank you for choosing Riven Trading Platform!
    `;

    return this.sendEmail({
      to: user.email,
      subject: alpacaAccountCreated ?
        '🎉 Welcome to Riven! Your Trading Account is Ready' :
        '🎉 Welcome to Riven! Account Setup in Progress',
      html,
      text
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