require('dotenv').config();
const { connectDB } = require('../src/config/database');
const { User, Wallet } = require('../src/models');

async function seed() {
  await connectDB();

  const email = 'admin@riven.com';
  const existing = await User.findOne({ where: { email } });

  if (existing) {
    console.log('Admin user already exists:', email);
    process.exit(0);
  }

  const user = await User.create({
    first_name: 'Riven',
    last_name: 'Admin',
    email,
    phone: '+254000000000',
    password: process.env.ADMIN_PASSWORD || 'Admin@Riven2026!',
    role: 'admin',
    status: 'active',
    is_email_verified: true,
  });

  await Wallet.create({ user_id: user.id });

  console.log('Admin user created:', email);
  console.log('Password:', process.env.ADMIN_PASSWORD || 'Admin@Riven2026!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
