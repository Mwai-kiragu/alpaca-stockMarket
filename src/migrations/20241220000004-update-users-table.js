'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`ALTER TYPE "enum_users_gender" ADD VALUE IF NOT EXISTS 'not_specified';`);
    await queryInterface.sequelize.query(`ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'initial_completed';`);

    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN NOT NULL DEFAULT false;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted BOOLEAN NOT NULL DEFAULT false;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS quiz_answers JSONB;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS quiz_completed_at TIMESTAMPTZ;`);

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_users_registration_status" AS ENUM (
          'started', 'email_verified', 'phone_verified', 'quiz_completed', 'documents_uploaded', 'completed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_status "enum_users_registration_status" NOT NULL DEFAULT 'started';
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'terms_accepted');
    await queryInterface.removeColumn('users', 'privacy_accepted');
    await queryInterface.removeColumn('users', 'terms_accepted_at');
    await queryInterface.removeColumn('users', 'privacy_accepted_at');
    await queryInterface.removeColumn('users', 'quiz_answers');
    await queryInterface.removeColumn('users', 'quiz_completed_at');
    await queryInterface.removeColumn('users', 'registration_status');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_registration_status";');
  }
};
