const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    const port = parseInt(process.env.MAIL_PORT) || 587;
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || 'mail.rivenapp.com',
      port: port,
      secure: port === 465, // true for 465 (SSL), false for 587 (STARTTLS)
      auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Verify connection configuration (only in production)
    if (process.env.NODE_ENV === 'production' && process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD) {
      this.transporter.verify((error, success) => {
        if (error) {
          logger.warn('Email service connection failed. Emails will not be sent:', error.message);
        } else {
          logger.info('Email service is ready to send messages');
        }
      });
    } else if (process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD) {
      logger.info('Email service initialized (verification skipped in development)');
    } else {
      logger.warn('Email service not configured. Set MAIL_USERNAME and MAIL_PASSWORD to enable emails.');
    }
  }

  async sendEmail({ to, subject, html, text }) {
    try {
      if (!process.env.MAIL_USERNAME || !process.env.MAIL_PASSWORD) {
        logger.warn('SMTP credentials not configured. Email not sent.');
        return { success: false, message: 'Email service not configured' };
      }

      const mailOptions = {
        from: `${process.env.APP_NAME || 'Riven Trading'} <${process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME}>`,
        to,
        subject,
        text: text || 'This email requires HTML support to view properly.',
        html,
        headers: {
          'X-Priority': '3',
          'X-Mailer': 'RIVEN Platform'
        }
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
          <h1 style="color: #2c5aa0;">Welcome to Riven Trading</h1>
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
      Welcome to Riven Trading Platform!

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
      subject: `Verify Your Email - Code: ${verificationCode}`,
      html,
      text
    });
  }

  async sendWelcomeEmail(user, verificationToken) {
    const verificationUrl = `${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/verify-email?token=${verificationToken}`;

    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c5aa0;">Welcome to Riven Trading</h1>
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
      Welcome to Riven Trading!

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
      subject: 'Welcome to Riven Trading - Verify Your Email',
      html,
      text
    });
  }

  async sendPasswordResetEmail(user, resetCode) {
    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #dc3545;">🔐 Password Reset Request</h1>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #333; margin-top: 0;">Hello ${user.first_name}!</h2>
          <p style="color: #666; line-height: 1.6;">
            You requested to reset your password for your Riven account.
            Please use the verification code below to reset your password.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0; background: #ffe3e5; padding: 30px; border-radius: 10px;">
          <p style="color: #dc3545; font-size: 18px; margin-bottom: 10px; font-weight: bold;">Your password reset code is:</p>
          <div style="background: #dc3545; color: white; padding: 20px; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 4px; font-family: 'Courier New', monospace;">
            ${resetCode}
          </div>
          <p style="color: #666; font-size: 14px; margin-top: 15px;">
            This code will expire in 1 hour for security purposes.
          </p>
        </div>

        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #495057; margin-top: 0;">How to use this code:</h3>
          <ol style="color: #6c757d;">
            <li>Open the Trading Platform app or website</li>
            <li>Go to "Forgot Password" or "Reset Password"</li>
            <li>Enter this verification code: <strong>${resetCode}</strong></li>
            <li>Create your new password</li>
          </ol>
        </div>

        <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin-bottom: 20px;">
          <h4 style="color: #721c24; margin-top: 0;">⏰ Important Security Info</h4>
          <ul style="color: #721c24; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.5;">
            <li>This reset code expires in <strong>1 hour</strong></li>
            <li>Can only be used <strong>once</strong></li>
            <li>Never share this code with anyone</li>
            <li>If you didn't request this, please ignore this email</li>
          </ul>
        </div>

        <div style="border-top: 1px solid #dee2e6; padding-top: 20px; text-align: center; color: #6c757d; font-size: 12px;">
          <p>If you didn't request this password reset, please ignore this email.</p>
          <p>For security reasons, never share this verification code with anyone.</p>
          <p>Trading Platform Security Team</p>
        </div>
      </div>
    `;

    const text = `
      Password Reset Request - Trading Platform

      Hello ${user.first_name},

      You requested to reset your password for your Riven account.
      Please use the verification code below to reset your password:

      Password Reset Code: ${resetCode}

      How to use this code:
      1. Open your Riven App
      2. Go to "Forgot Password" or "Reset Password"
      3. Enter this verification code: ${resetCode}
      4. Create your new password

      SECURITY INFO:
      - Code expires in 1 hour
      - Can only be used once
      - Never share with anyone
      - If you didn't request this, ignore this email

      For security reasons, never share this verification code with anyone.

      Trading Platform Security Team
    `;

    return this.sendEmail({
      to: user.email,
      subject: `🔐 Password Reset Code: ${resetCode}`,
      html,
      text
    });
  }

  async sendPasswordResetConfirmationEmail(user) {
    const html = `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #28a745;">✅ Password Reset Successful</h1>
        </div>

        <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #28a745;">
          <h2 style="color: #155724; margin-top: 0;">Hello ${user.first_name}!</h2>
          <p style="color: #155724; line-height: 1.6;">
            Your password has been successfully reset for your Riven account.
            You can now log in with your new password.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/login"
             style="background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            Log In Now
          </a>
        </div>

        <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin-bottom: 20px;">
          <h4 style="color: #721c24; margin-top: 0;">🔒 Security Notice</h4>
          <p style="color: #721c24; font-size: 14px; margin: 0; line-height: 1.5;">
            If you didn't reset your password, please contact our support team immediately.
            Your account security is important to us.
          </p>
        </div>

        <div style="border-top: 1px solid #dee2e6; padding-top: 20px; text-align: center; color: #6c757d; font-size: 12px;">
          <p>This is an automated security notification.</p>
          <p>Trading Platform Security Team</p>
        </div>
      </div>
    `;

    const text = `
      Password Reset Successful - Trading Platform

      Hello ${user.first_name},

      Your password has been successfully reset for your Riven account.
      You can now log in with your new password.

      Log in: ${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/login

      SECURITY NOTICE:
      If you didn't reset your password, please contact our support team immediately.

      Trading Platform Security Team
    `;

    return this.sendEmail({
      to: user.email,
      subject: '✅ Password Reset Successful - Trading Platform',
      html,
      text
    });
  }

  async sendRegistrationWelcomeEmail(user) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

          <!-- Main Card -->
          <div style="background: #ffffff; border-radius: 16px; padding: 40px 30px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);">

            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #1a1a1a; font-size: 28px; font-weight: 700; margin: 0 0 10px 0;">Welcome to Riven!</h1>
              <p style="color: #666666; font-size: 16px; margin: 0;">Your journey to US stock trading starts here</p>
            </div>

            <!-- Welcome Message -->
            <div style="background: linear-gradient(135deg, #1a1a1a 0%, #333333 100%); border-radius: 12px; padding: 25px; margin-bottom: 25px; color: white;">
              <h2 style="margin: 0 0 10px 0; font-size: 20px;">Hello ${user.first_name}!</h2>
              <p style="margin: 0; line-height: 1.6; opacity: 0.9;">
                Thank you for joining Riven. We're excited to have you on board. You're now one step closer to investing in the world's largest stock market.
              </p>
            </div>

            <!-- What's Next Section -->
            <div style="margin-bottom: 25px;">
              <h3 style="color: #1a1a1a; font-size: 18px; margin: 0 0 15px 0;">Getting Started</h3>

              <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
                <div style="background: #e8f5e9; color: #2e7d32; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px; flex-shrink: 0; line-height: 28px; text-align: center; font-size: 14px;">1</div>
                <div>
                  <p style="margin: 0; color: #1a1a1a; font-weight: 600;">Verify Your Email</p>
                  <p style="margin: 5px 0 0 0; color: #666666; font-size: 14px;">Check your inbox for the verification code</p>
                </div>
              </div>

              <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
                <div style="background: #e3f2fd; color: #1976d2; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px; flex-shrink: 0; line-height: 28px; text-align: center; font-size: 14px;">2</div>
                <div>
                  <p style="margin: 0; color: #1a1a1a; font-weight: 600;">Complete Your Profile</p>
                  <p style="margin: 5px 0 0 0; color: #666666; font-size: 14px;">Add your personal details and verify your phone</p>
                </div>
              </div>

              <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
                <div style="background: #fff3e0; color: #f57c00; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px; flex-shrink: 0; line-height: 28px; text-align: center; font-size: 14px;">3</div>
                <div>
                  <p style="margin: 0; color: #1a1a1a; font-weight: 600;">Complete KYC Verification</p>
                  <p style="margin: 5px 0 0 0; color: #666666; font-size: 14px;">Upload your ID for secure trading access</p>
                </div>
              </div>

              <div style="display: flex; align-items: flex-start;">
                <div style="background: #f3e5f5; color: #7b1fa2; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px; flex-shrink: 0; line-height: 28px; text-align: center; font-size: 14px;">4</div>
                <div>
                  <p style="margin: 0; color: #1a1a1a; font-weight: 600;">Fund & Start Trading</p>
                  <p style="margin: 5px 0 0 0; color: #666666; font-size: 14px;">Deposit via M-Pesa and invest in US stocks</p>
                </div>
              </div>
            </div>

            <!-- Features Highlight -->
            <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; margin-bottom: 25px;">
              <h3 style="color: #1a1a1a; font-size: 16px; margin: 0 0 15px 0;">Why Trade with Riven?</h3>
              <ul style="margin: 0; padding: 0 0 0 20px; color: #666666; line-height: 1.8;">
                <li>Access to 5,000+ US stocks & ETFs</li>
                <li>Easy M-Pesa deposits & withdrawals</li>
                <li>Real-time market data</li>
                <li>Fractional shares starting from $1</li>
                <li>Secure & regulated platform</li>
              </ul>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin-bottom: 25px;">
              <a href="${process.env.CLIENT_URL || 'https://app.rivenapp.com'}"
                 style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Open Riven App
              </a>
            </div>

            <!-- Support -->
            <div style="text-align: center; padding: 20px 0; border-top: 1px solid #eee;">
              <p style="color: #888888; font-size: 14px; margin: 0 0 10px 0;">Need help getting started?</p>
              <a href="mailto:support@rivenapp.com" style="color: #1a1a1a; font-weight: 600; text-decoration: none;">Contact Support</a>
            </div>

          </div>

          <!-- Footer -->
          <div style="text-align: center; padding: 30px 20px; color: #888888; font-size: 12px;">
            <p style="margin: 0 0 5px 0; font-size: 18px; font-weight: 700; color: #1a1a1a; letter-spacing: 2px;">RIVEN</p>
            <p style="margin: 0 0 15px 0;">Invest in the future, today.</p>
            <p style="margin: 0;">© ${new Date().getFullYear()} Riven. All rights reserved.</p>
          </div>

        </div>
      </body>
      </html>
    `;

    const text = `
Welcome to Riven!

Hello ${user.first_name},

Thank you for joining Riven. We're excited to have you on board. You're now one step closer to investing in the world's largest stock market.

GETTING STARTED:

1. Verify Your Email
   Check your inbox for the verification code

2. Complete Your Profile
   Add your personal details and verify your phone

3. Complete KYC Verification
   Upload your ID for secure trading access

4. Fund & Start Trading
   Deposit via M-Pesa and invest in US stocks

WHY TRADE WITH RIVEN?
- Access to 5,000+ US stocks & ETFs
- Easy M-Pesa deposits & withdrawals
- Real-time market data
- Fractional shares starting from $1
- Secure & regulated platform

Need help? Contact us at support@rivenapp.com

RIVEN - Invest in the future, today.
© ${new Date().getFullYear()} Riven. All rights reserved.
    `;

    return this.sendEmail({
      to: user.email,
      subject: `Welcome to Riven, ${user.first_name}!`,
      html,
      text
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
          <a href="${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/dashboard"
             style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
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
          <a href="${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/portfolio"
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
          <a href="${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/dashboard"
             style="background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
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

      Visit your dashboard: ${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/dashboard

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

  async sendWaitlistWelcomeEmail(userData) {
    const { email, referralCode, referralLink, peopleAhead, position, totalUsers } = userData;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <div style="max-width: 450px; margin: 0 auto; padding: 40px 20px;">

          <!-- Main Card -->
          <div style="background: #ffffff; border-radius: 16px; padding: 40px 30px; text-align: center; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);">

            <!-- Thank You Header -->
            <h1 style="color: #1a1a1a; font-size: 28px; font-weight: 600; margin: 0 0 10px 0;">Thank you!</h1>
            <p style="color: #666666; font-size: 16px; margin: 0 0 30px 0;">We have added your email to our waitlist</p>

            <!-- Position Card -->
            <div style="background: #f8f9fa; border-left: 4px solid #1a1a1a; border-radius: 8px; padding: 20px; margin: 0 0 30px 0;">
              <p style="color: #1a1a1a; font-size: 22px; font-weight: 700; margin: 0 0 8px 0;">
                ${peopleAhead.toLocaleString()} People are ahead of you
              </p>
              <p style="color: #888888; font-size: 14px; margin: 0;">
                This reservation is held for ${email}.<br>
                <a href="#" style="color: #666666;">Is this not you?</a>
              </p>
            </div>

            <!-- Priority Access Section -->
            <div style="margin: 30px 0;">
              <h2 style="color: #1a1a1a; font-size: 18px; font-weight: 600; margin: 0 0 10px 0;">Interested in Priority access?</h2>
              <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 25px 0;">
                Get early access by referring your friend.<br>
                The more friends that join, you move up<br>
                the waitlist, the sooner you'll get access.
              </p>
            </div>

            <!-- Invite Button -->
            <a href="${referralLink}"
               style="display: block; background: #1a1a1a; color: #ffffff; text-decoration: none; padding: 16px 30px; border-radius: 8px; font-size: 16px; font-weight: 600; margin: 0 0 30px 0;">
              Invite Friends
            </a>

            <!-- Referral Link Box -->
            <div style="background: #f8f9fa; border-radius: 8px; padding: 15px; margin: 0 0 30px 0;">
              <p style="color: #888888; font-size: 12px; margin: 0 0 8px 0;">Your referral link:</p>
              <p style="color: #1a1a1a; font-size: 14px; font-weight: 500; margin: 0; word-break: break-all;">
                ${referralLink}
              </p>
            </div>

            <!-- Logo -->
            <div style="margin-top: 20px;">
              <img src="https://www.rivenapp.com/logo.png" alt="RIVEN" style="height: 40px; width: auto;" onerror="this.style.display='none'">
              <p style="color: #1a1a1a; font-size: 20px; font-weight: 700; margin: 10px 0 0 0; letter-spacing: 2px;">RIVEN</p>
            </div>

          </div>

          <!-- Footer -->
          <div style="text-align: center; padding: 20px; color: #888888; font-size: 12px;">
            <p style="margin: 0 0 10px 0;">You're receiving this because you signed up for the Riven waitlist.</p>
            <p style="margin: 0;">© ${new Date().getFullYear()} Riven. All rights reserved.</p>
          </div>

        </div>
      </body>
      </html>
    `;

    const text = `
Thank you!

We have added your email to our waitlist.

${peopleAhead.toLocaleString()} People are ahead of you

This reservation is held for ${email}.

---

Interested in Priority access?

Get early access by referring your friend.
The more friends that join, you move up the waitlist, the sooner you'll get access.

Your referral link: ${referralLink}

Share this link with your friends to move up the waitlist!

---

RIVEN
© ${new Date().getFullYear()} Riven. All rights reserved.
    `;

    return this.sendEmail({
      to: email,
      subject: `You're on the Riven waitlist! ${peopleAhead.toLocaleString()} people ahead`,
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
              <a href="${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/support/tickets/${ticketData.ticketId}"
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
              <a href="${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/support/tickets/${ticketData.ticketId}"
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
              <a href="${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/support/tickets/${ticketData.ticketId}"
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
              <a href="${process.env.CLIENT_URL || 'https://api.rivenapp.com'}/support/tickets/${ticketData.ticketId}"
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