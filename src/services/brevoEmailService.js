const axios = require('axios');
const logger = require('../utils/logger');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const sender = {
  name: process.env.APP_NAME || 'Riven Trading',
  email: process.env.MAIL_FROM_ADDRESS || 'noreply@rivenapp.com'
};

const send = async ({ to, subject, html, text }) => {
  if (!process.env.BREVO_API_KEY) {
    logger.warn('BREVO_API_KEY not set. Email not sent.');
    return { success: false, message: 'Email service not configured' };
  }

  try {
    const response = await axios.post(
      BREVO_API_URL,
      {
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text || 'This email requires HTML support to view properly.'
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info(`Brevo email sent to ${to}: messageId=${response.data.messageId}`);
    return { success: true, messageId: response.data.messageId };
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    logger.error(`Brevo failed to send email to ${to}:`, errMsg);
    return { success: false, error: errMsg };
  }
};

const sendVerificationCodeEmail = (user, verificationCode) => {
  const html = `
    <div style="max-width:600px;margin:0 auto;padding:20px;font-family:Arial,sans-serif;">
      <div style="text-align:center;margin-bottom:30px;">
        <h1 style="color:#1a1a1a;">Riven Trading</h1>
      </div>

      <div style="background:#f8f9fa;padding:20px;border-radius:8px;margin-bottom:20px;">
        <h2 style="color:#333;">Hello ${user.first_name}!</h2>
        <p style="color:#666;line-height:1.6;">
          Use the code below to verify your email address and complete your registration.
        </p>
      </div>

      <div style="text-align:center;margin:30px 0;background:#e3f2fd;padding:30px;border-radius:10px;">
        <p style="color:#1976d2;font-size:16px;margin-bottom:10px;font-weight:bold;">Your verification code:</p>
        <div style="background:#1a1a1a;color:white;padding:20px;border-radius:8px;font-size:36px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace;">
          ${verificationCode}
        </div>
        <p style="color:#666;font-size:13px;margin-top:15px;">Expires in 10 minutes. Do not share this code.</p>
      </div>

      <div style="border-top:1px solid #dee2e6;padding-top:20px;text-align:center;color:#888;font-size:12px;">
        <p>If you didn't create a Riven account, you can safely ignore this email.</p>
        <p style="margin:0;">© ${new Date().getFullYear()} Riven. All rights reserved.</p>
      </div>
    </div>
  `;

  const text = `Hello ${user.first_name},\n\nYour Riven verification code is: ${verificationCode}\n\nExpires in 10 minutes. Do not share this code.\n\nIf you didn't create a Riven account, ignore this email.`;

  return send({
    to: user.email,
    subject: `${verificationCode} is your Riven verification code`,
    html,
    text
  });
};

const sendPasswordResetEmail = (user, resetCode) => {
  const html = `
    <div style="max-width:600px;margin:0 auto;padding:20px;font-family:Arial,sans-serif;">
      <div style="text-align:center;margin-bottom:30px;">
        <h1 style="color:#1a1a1a;">Riven Trading</h1>
      </div>

      <div style="background:#f8f9fa;padding:20px;border-radius:8px;margin-bottom:20px;">
        <h2 style="color:#333;">Hello ${user.first_name}!</h2>
        <p style="color:#666;line-height:1.6;">We received a request to reset your password. Use the code below.</p>
      </div>

      <div style="text-align:center;margin:30px 0;background:#ffe3e5;padding:30px;border-radius:10px;">
        <p style="color:#dc3545;font-size:16px;margin-bottom:10px;font-weight:bold;">Password reset code:</p>
        <div style="background:#dc3545;color:white;padding:20px;border-radius:8px;font-size:36px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace;">
          ${resetCode}
        </div>
        <p style="color:#666;font-size:13px;margin-top:15px;">Expires in 1 hour. Do not share this code.</p>
      </div>

      <div style="border-top:1px solid #dee2e6;padding-top:20px;text-align:center;color:#888;font-size:12px;">
        <p>If you didn't request a password reset, please ignore this email.</p>
        <p style="margin:0;">© ${new Date().getFullYear()} Riven. All rights reserved.</p>
      </div>
    </div>
  `;

  const text = `Hello ${user.first_name},\n\nYour Riven password reset code is: ${resetCode}\n\nExpires in 1 hour. Do not share this code.\n\nIf you didn't request this, ignore this email.`;

  return send({
    to: user.email,
    subject: `${resetCode} is your Riven password reset code`,
    html,
    text
  });
};

module.exports = {
  send,
  sendVerificationCodeEmail,
  sendPasswordResetEmail
};
