require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
  console.log('📧 Testing email with configuration:');
  console.log('Host:', process.env.MAIL_HOST);
  console.log('Port:', process.env.MAIL_PORT);
  console.log('User:', process.env.MAIL_USERNAME);
  console.log('Encryption:', process.env.MAIL_ENCRYPTION || 'none');
  console.log('---');

  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: parseInt(process.env.MAIL_PORT),
    secure: false,
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔌 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP server is ready');

    console.log('📤 Sending test email...');
    const info = await transporter.sendMail({
      from: `"Riven Trading Platform" <${process.env.MAIL_FROM_ADDRESS}>`,
      to: 'onesmusmwai40@gmail.com',
      subject: 'Test Email from Riven Trading Platform',
      text: 'If you receive this, your email is working perfectly!',
      html: '<h1>✅ Success!</h1><p>Your email configuration is working correctly.</p><p><strong>Email:</strong> ' + process.env.MAIL_USERNAME + '</p>'
    });

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) console.error('Error Code:', error.code);
    if (error.command) console.error('Failed Command:', error.command);
  }
}

testEmail();
