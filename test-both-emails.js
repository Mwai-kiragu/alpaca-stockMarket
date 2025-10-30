require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmailConfig(config, name) {
  console.log(`\n🧪 Testing ${name}...`);
  console.log(`User: ${config.user}`);
  console.log(`Pass: ${config.pass.substring(0, 3)}***`);

  const transporter = nodemailer.createTransport({
    host: 'mail.rivenapp.com',
    port: 587,
    secure: false,
    auth: {
      user: config.user,
      pass: config.pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    await transporter.verify();
    console.log(`✅ ${name} - Authentication SUCCESS!`);
    return true;
  } catch (error) {
    console.log(`❌ ${name} - Authentication FAILED`);
    console.log(`Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('📧 Testing Both Email Configurations');
  console.log('=====================================');

  // Test Configuration 1
  const config1 = {
    user: 'no-reply@rivenapp.com',
    pass: '7~*6Ckfyl?7u'
  };

  // Test Configuration 2
  const config2 = {
    user: 'noreply.trade@rivenapp.com',
    pass: 'Ud5e7Ct8H+w8R@'
  };

  const result1 = await testEmailConfig(config1, 'Config 1 (no-reply@rivenapp.com)');
  const result2 = await testEmailConfig(config2, 'Config 2 (noreply.trade@rivenapp.com)');

  console.log('\n📊 RESULTS:');
  console.log('=====================================');
  if (result1) {
    console.log('✅ Use: no-reply@rivenapp.com with password 7~*6Ckfyl?7u');
  } else if (result2) {
    console.log('✅ Use: noreply.trade@rivenapp.com with password Ud5e7Ct8H+w8R@');
  } else {
    console.log('❌ Both configurations failed!');
    console.log('\n🔧 Next Steps:');
    console.log('1. Login to cPanel at https://rivenapp.com:2083');
    console.log('2. Go to Email Accounts');
    console.log('3. Check which email accounts exist');
    console.log('4. Reset the password for the existing account');
    console.log('5. Update your .env file with the correct credentials');
  }
}

runTests();
