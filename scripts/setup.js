const { connectDB } = require('../src/config/database');
const { User, Wallet } = require('../src/models');

require('dotenv').config();

const setupDatabase = async () => {
  try {
    console.log('🔄 Setting up database...');

    await connectDB();
    console.log('✅ Connected to PostgreSQL');

    const adminExists = await User.findOne({
      where: { role: 'admin' }
    });

    if (!adminExists) {
      console.log('🔄 Creating admin user...');

      const admin = await User.create({
        first_name: 'Admin',
        last_name: 'User',
        email: 'admin@tradingplatform.com',
        phone: '+254700000000',
        password: 'admin123',
        role: 'admin',
        kyc_status: 'approved',
        is_email_verified: true,
        is_phone_verified: true
      });

      await Wallet.create({
        user_id: admin.id,
        kes_balance: 0,
        usd_balance: 0
      });

      console.log('✅ Admin user created');
      console.log('📧 Email: admin@tradingplatform.com');
      console.log('🔑 Password: admin123');
    } else {
      console.log('✅ Admin user already exists');
    }

    console.log('✅ Database setup completed');

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
};

setupDatabase();