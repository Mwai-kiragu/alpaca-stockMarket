'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Starting migration to fix existing user registration steps...');

      // Get all users with their current data
      const users = await queryInterface.sequelize.query(
        'SELECT id, registration_step, kyc_data, terms_accepted, privacy_accepted FROM users',
        { type: queryInterface.sequelize.QueryTypes.SELECT }
      );

      console.log(`Found ${users.length} users to potentially update...`);

      let updatedCount = 0;

      for (const user of users) {
        let newStep = user.registration_step;
        const kycData = user.kyc_data || {};

        // Determine the correct step based on completed data
        if (!kycData.personalInfo) {
          newStep = 'personal_info';
        } else if (!kycData.employmentInfo) {
          newStep = 'employment_info';
        } else if (!kycData.kyc) {
          newStep = 'kyc_verification';
        } else if (!kycData.trustedContact) {
          newStep = 'trusted_contact';
        } else if (!kycData.documents || !kycData.documents.idFront) {
          newStep = 'documents'; // Need to upload ID Front
        } else if (kycData.documents.idFront && !kycData.documents.idBack) {
          newStep = 'documents'; // Need to upload ID Back
        } else if (kycData.documents.idFront && kycData.documents.idBack && !kycData.documents.proofOfAddress) {
          newStep = 'documents'; // Need to upload Proof of Address
        } else if (kycData.documents.idFront && kycData.documents.idBack && kycData.documents.proofOfAddress && (!user.terms_accepted || !user.privacy_accepted)) {
          newStep = 'agreements'; // All documents complete, need agreements
        } else if (user.terms_accepted && user.privacy_accepted) {
          newStep = 'completed'; // All done
        }

        // Only update if the step has changed
        if (newStep !== user.registration_step) {
          await queryInterface.sequelize.query(
            'UPDATE users SET registration_step = ? WHERE id = ?',
            { replacements: [newStep, user.id], type: queryInterface.sequelize.QueryTypes.UPDATE }
          );
          updatedCount++;
          console.log(`Updated user ${user.id}: ${user.registration_step} -> ${newStep}`);
        }
      }

      console.log(`Migration completed. Updated ${updatedCount} users.`);

    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Rolling back registration step fixes...');

      // This rollback is intentionally minimal since we're correcting data
      // and don't want to put users back in incorrect states
      console.log('Rollback completed - no changes made to preserve data integrity');

    } catch (error) {
      console.error('Rollback error:', error);
      throw error;
    }
  }
};