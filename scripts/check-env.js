require('dotenv').config();

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ALPACA_API_KEY',
  'ALPACA_SECRET_KEY',
  'MPESA_CONSUMER_KEY',
  'MPESA_CONSUMER_SECRET',
  'MPESA_PASSKEY',
  'MPESA_SHORTCODE'
];

const optionalEnvVars = [
  'PORT',
  'NODE_ENV',
  'ALPACA_BASE_URL',
  'ALPACA_DATA_BASE_URL',
  'EXCHANGE_RATE_API_KEY',
  'MPESA_CALLBACK_URL'
];

console.log('🔍 Checking environment variables...\n');

let missingRequired = [];
let missingOptional = [];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    missingRequired.push(envVar);
    console.log(`❌ ${envVar}: Missing (Required)`);
  } else {
    console.log(`✅ ${envVar}: Set`);
  }
});

console.log('\n📋 Optional environment variables:');

optionalEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    missingOptional.push(envVar);
    console.log(`⚠️  ${envVar}: Missing (Optional)`);
  } else {
    console.log(`✅ ${envVar}: Set`);
  }
});

console.log('\n📊 Summary:');
console.log(`✅ Required variables: ${requiredEnvVars.length - missingRequired.length}/${requiredEnvVars.length}`);
console.log(`⚠️  Optional variables: ${optionalEnvVars.length - missingOptional.length}/${optionalEnvVars.length}`);

if (missingRequired.length > 0) {
  console.log('\n❌ Missing required environment variables:');
  missingRequired.forEach(envVar => console.log(`   - ${envVar}`));
  console.log('\nPlease set these variables in your .env file before starting the application.');
  process.exit(1);
}

if (missingOptional.length > 0) {
  console.log('\n⚠️  Missing optional environment variables:');
  missingOptional.forEach(envVar => console.log(`   - ${envVar}`));
  console.log('The application will use default values for these.');
}

console.log('\n🎉 Environment check passed! Ready to start the application.');
process.exit(0);