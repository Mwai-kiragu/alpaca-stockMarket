const { Wallet, Transaction, User } = require('../models');
const logger = require('../utils/logger');
const { sequelize } = require('../config/database');

const handleKCBMpesaCallback = async (req, res) => {
  const dbTransaction = await sequelize.transaction();

  try {
    logger.info('KCB M-Pesa callback received:', JSON.stringify(req.body, null, 2));

    const callbackData = req.body;

    if (!callbackData || !callbackData.Body || !callbackData.Body.stkCallback) {
      logger.error('Invalid KCB M-Pesa callback structure');
      await dbTransaction.rollback();

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Callback received'
      });
    }

    const stkCallback = callbackData.Body.stkCallback;
    const resultCode = parseInt(stkCallback.ResultCode);
    const resultDesc = stkCallback.ResultDesc;
    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const merchantRequestId = stkCallback.MerchantRequestID;

    logger.info('Processing KCB M-Pesa callback:', {
      resultCode,
      resultDesc,
      checkoutRequestId,
      merchantRequestId
    });

    // Find the pending transaction - since we don't have a payment_method column,
    // we search for the most recent pending deposit transaction
    const pendingTransaction = await Transaction.findOne({
      where: {
        status: 'pending',
        type: 'deposit'
      },
      order: [['created_at', 'DESC']],
      limit: 1,
      transaction: dbTransaction,
      include: [{
        model: Wallet,
        as: 'wallet'
      }]
    });

    if (!pendingTransaction) {
      logger.error('No pending KCB M-Pesa transaction found');
      await dbTransaction.rollback();

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Callback received'
      });
    }

    if (resultCode === 0) {
      logger.info('KCB M-Pesa payment successful');
      const callbackMetadata = stkCallback.CallbackMetadata;
      let amount = 0;
      let mpesaReceiptNumber = '';
      let transactionDate = '';
      let phoneNumber = '';

      if (callbackMetadata && callbackMetadata.Item) {
        callbackMetadata.Item.forEach(item => {
          switch (item.Name) {
            case 'Amount':
              amount = parseFloat(item.Value);
              break;
            case 'MpesaReceiptNumber':
              mpesaReceiptNumber = item.Value;
              break;
            case 'TransactionDate':
              transactionDate = item.Value;
              break;
            case 'PhoneNumber':
              phoneNumber = item.Value;
              break;
          }
        });
      }

      // Get wallet from the transaction relationship
      let wallet = pendingTransaction.wallet;

      if (!wallet) {
        // This shouldn't happen if transaction was created properly, but handle it
        wallet = await Wallet.findOne({
          where: { id: pendingTransaction.wallet_id },
          transaction: dbTransaction
        });
      }

      if (!wallet) {
        logger.error('Wallet not found for transaction:', {
          transactionId: pendingTransaction.id,
          walletId: pendingTransaction.wallet_id
        });
        await dbTransaction.rollback();
        return res.status(200).json({
          ResultCode: 0,
          ResultDesc: 'Wallet not found'
        });
      }

      await wallet.increment('kes_balance', {
        by: amount,
        transaction: dbTransaction
      });

      await pendingTransaction.update({
        status: 'completed',
        amount: amount,
        metadata: {
          ...pendingTransaction.metadata,
          mpesaReceiptNumber,
          transactionDate,
          phoneNumber,
          checkoutRequestId,
          merchantRequestId,
          resultCode,
          resultDesc,
          callbackReceived: new Date().toISOString()
        }
      }, { transaction: dbTransaction });

      await dbTransaction.commit();

      logger.info('KCB M-Pesa payment processed successfully:', {
        userId: wallet.user_id,
        amount,
        mpesaReceiptNumber,
        transactionId: pendingTransaction.id
      });

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Payment processed successfully'
      });

    } else {
      // FAILED - User cancelled, wrong PIN, timeout, etc.

      let failureReason = '';

      switch (resultCode) {
        case 1:
          failureReason = 'Insufficient funds in M-Pesa account';
          break;
        case 1032:
          failureReason = 'User cancelled the transaction';
          break;
        case 1037:
          failureReason = 'Transaction timeout - user did not enter PIN';
          break;
        case 2001:
          failureReason = 'Wrong PIN entered';
          break;
        default:
          failureReason = resultDesc || 'Payment failed';
      }

      logger.warn('KCB M-Pesa payment failed:', {
        userId: pendingTransaction.wallet?.user_id || 'unknown',
        resultCode,
        failureReason,
        checkoutRequestId
      });

      // Update transaction as failed
      await pendingTransaction.update({
        status: 'failed',
        metadata: {
          ...pendingTransaction.metadata,
          checkoutRequestId,
          merchantRequestId,
          resultCode,
          resultDesc,
          failureReason,
          callbackReceived: new Date().toISOString()
        }
      }, { transaction: dbTransaction });

      await dbTransaction.commit();

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Callback received'
      });
    }

  } catch (error) {
    await dbTransaction.rollback();

    logger.error('KCB M-Pesa callback processing error:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });

    // Always return 200 to prevent retries
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback received'
    });
  }
};

const getMpesaResultCodeDescription = (resultCode) => {
  const descriptions = {
    0: 'Success - Payment completed',
    1: 'Insufficient funds',
    1032: 'Transaction cancelled by user',
    1037: 'Timeout - User did not enter PIN',
    2001: 'Wrong PIN entered',
    1019: 'Transaction failed',
    1001: 'Unable to lock subscriber',
    17: 'System internal error'
  };

  return descriptions[resultCode] || `Unknown error (Code: ${resultCode})`;
};

module.exports = {
  handleKCBMpesaCallback,
  getMpesaResultCodeDescription
};
