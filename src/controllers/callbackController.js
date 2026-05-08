const { Wallet, Transaction, User } = require('../models');
const logger = require('../utils/logger');
const { sequelize } = require('../config/database');
const websocketService = require('../services/websocketService');
const { publishPaymentEvent } = require('../utils/redisPayment');

const handleKCBMpesaCallback = async (req, res) => {
  // Log immediately - even before any processing
  console.log('========== KCB CALLBACK RECEIVED ==========');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('============================================');

  try {
    logger.info('KCB callback received:', JSON.stringify(req.body, null, 2));

    const callbackData = req.body;

    // Detect callback type and route accordingly
    if (callbackData?.Body?.stkCallback) {
      // STK Push (Deposit) callback
      return await handleSTKPushCallback(callbackData, res);
    } else if (callbackData?.transactionReference || callbackData?.merchantID || callbackData?.retrievalRefNumber) {
      // B2C (Withdrawal) callback
      return await handleB2CCallback(callbackData, res);
    } else {
      logger.warn('Unknown KCB callback structure:', JSON.stringify(callbackData, null, 2));
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Callback received - unknown structure'
      });
    }
  } catch (error) {
    logger.error('KCB callback routing error:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback received'
    });
  }
};

// Handle B2C (Withdrawal) callback
const handleB2CCallback = async (callbackData, res) => {
  const dbTransaction = await sequelize.transaction();

  try {
    const transactionReference = callbackData.transactionReference ||
                                  callbackData.retrievalRefNumber ||
                                  callbackData.TransactionID;
    const statusCode = callbackData.statusCode || callbackData.ResultCode;
    const statusMessage = callbackData.statusMessage || callbackData.ResultDesc;
    const statusDescription = callbackData.statusDescription;
    const merchantID = callbackData.merchantID;

    logger.info('Processing B2C withdrawal callback:', {
      transactionReference,
      statusCode,
      statusMessage,
      merchantID
    });

    // Find the pending withdrawal transaction
    const pendingTransaction = await Transaction.findOne({
      where: {
        reference: transactionReference,
        type: 'withdrawal',
        status: 'pending'
      },
      include: [{
        model: Wallet,
        as: 'wallet'
      }],
      transaction: dbTransaction
    });

    if (!pendingTransaction) {
      logger.warn('No matching withdrawal transaction found:', { transactionReference });
      await dbTransaction.rollback();
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Callback received - no matching withdrawal'
      });
    }

    const wallet = pendingTransaction.wallet;

    // Check if successful (statusCode "0" means success for KCB)
    if (statusCode === '0' || statusCode === 0) {
      // SUCCESS - Mark withdrawal as completed
      await pendingTransaction.update({
        status: 'completed',
        metadata: {
          ...pendingTransaction.metadata,
          b2cCallback: callbackData,
          merchantID,
          completedAt: new Date().toISOString()
        }
      }, { transaction: dbTransaction });

      await dbTransaction.commit();

      logger.info('B2C withdrawal completed successfully:', {
        transactionReference,
        userId: wallet?.user_id,
        amount: pendingTransaction.amount
      });

      // Broadcast via WebSocket
      try {
        const paymentData = {
          status: 'completed',
          type: 'withdrawal',
          amount: pendingTransaction.amount,
          currency: 'KES',
          reference: transactionReference,
          timestamp: new Date().toISOString(),
          message: 'Withdrawal completed successfully! Money sent to M-Pesa.',
          wallet: wallet ? {
            balance_kes: wallet.kes_balance,
            balance_usd: wallet.usd_balance
          } : null,
          userId: wallet?.user_id
        };

        websocketService.broadcastPaymentUpdate(transactionReference, paymentData);
        await publishPaymentEvent(transactionReference, paymentData);
      } catch (wsError) {
        logger.error('Failed to broadcast withdrawal success:', wsError);
      }

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Withdrawal callback processed successfully'
      });

    } else {
      // FAILED - Refund the wallet and mark as failed
      const refundAmount = parseFloat(pendingTransaction.amount);

      await wallet.increment('kes_balance', {
        by: refundAmount,
        transaction: dbTransaction
      });

      await pendingTransaction.update({
        status: 'failed',
        metadata: {
          ...pendingTransaction.metadata,
          b2cCallback: callbackData,
          failureReason: statusDescription || statusMessage,
          refundedAmount: refundAmount,
          failedAt: new Date().toISOString()
        }
      }, { transaction: dbTransaction });

      await dbTransaction.commit();

      logger.warn('B2C withdrawal failed, wallet refunded:', {
        transactionReference,
        userId: wallet?.user_id,
        refundedAmount: refundAmount,
        reason: statusDescription || statusMessage
      });

      // Broadcast failure via WebSocket
      try {
        await wallet.reload();
        const paymentData = {
          status: 'failed',
          type: 'withdrawal',
          amount: pendingTransaction.amount,
          currency: 'KES',
          reference: transactionReference,
          timestamp: new Date().toISOString(),
          message: `Withdrawal failed: ${statusDescription || statusMessage}. Amount refunded to wallet.`,
          wallet: {
            balance_kes: wallet.kes_balance,
            balance_usd: wallet.usd_balance
          },
          userId: wallet?.user_id
        };

        websocketService.broadcastPaymentUpdate(transactionReference, paymentData);
        await publishPaymentEvent(transactionReference, paymentData);
      } catch (wsError) {
        logger.error('Failed to broadcast withdrawal failure:', wsError);
      }

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Withdrawal failure callback processed'
      });
    }

  } catch (error) {
    await dbTransaction.rollback();
    logger.error('B2C callback processing error:', {
      error: error.message,
      stack: error.stack
    });

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback received'
    });
  }
};

// Handle STK Push (Deposit) callback
const handleSTKPushCallback = async (callbackData, res) => {
  const dbTransaction = await sequelize.transaction();

  try {
    logger.info('Processing STK Push deposit callback');

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

    // Find the pending transaction by matching CheckoutRequestID in metadata
    const pendingTransactions = await Transaction.findAll({
      where: {
        status: 'pending',
        type: 'deposit'
      },
      transaction: dbTransaction,
      include: [{
        model: Wallet,
        as: 'wallet'
      }]
    });

    // Find the matching transaction by CheckoutRequestID in metadata
    const pendingTransaction = pendingTransactions.find(txn => {
      const kcbResponse = txn.metadata?.kcbResponse?.response;
      return kcbResponse?.CheckoutRequestID === checkoutRequestId ||
             kcbResponse?.MerchantRequestID === merchantRequestId;
    });

    if (!pendingTransaction) {
      logger.error('No matching KCB M-Pesa transaction found for callback:', {
        checkoutRequestId,
        merchantRequestId
      });
      await dbTransaction.rollback();

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Callback received - no matching transaction'
      });
    }

    logger.info('Found matching transaction:', {
      transactionId: pendingTransaction.id,
      reference: pendingTransaction.reference,
      checkoutRequestId
    });

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

      // Broadcast payment success via WebSocket to all subscribed clients
      try {
        // Reload wallet to get updated balance
        await wallet.reload();

        const paymentData = {
          status: 'completed',
          amount: amount,
          currency: 'KES',
          reference: mpesaReceiptNumber,
          timestamp: new Date().toISOString(),
          message: 'Payment completed successfully! Your wallet has been credited.',
          wallet: {
            balance_kes: wallet.kes_balance,
            balance_usd: wallet.usd_balance
          },
          metadata: {
            mpesaReceiptNumber,
            transactionDate,
            phoneNumber,
            transactionId: pendingTransaction.id
          },
          userId: wallet.user_id
        };

        // Broadcast via WebSocket (for Socket.IO clients)
        websocketService.broadcastPaymentUpdate(pendingTransaction.reference, paymentData);

        // Publish to Redis (for WebSocket clients using Redis pub/sub)
        await publishPaymentEvent(pendingTransaction.reference, paymentData);

        logger.info('Payment success WebSocket broadcast sent:', {
          messageId: pendingTransaction.reference,
          amount
        });
      } catch (wsError) {
        logger.error('Failed to broadcast payment success via WebSocket:', wsError);
        // Don't fail the callback if WebSocket fails
      }

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

      // Broadcast payment failure via WebSocket to all subscribed clients
      try {
        // Get wallet for balance info
        let wallet = pendingTransaction.wallet;
        if (!wallet) {
          wallet = await Wallet.findOne({
            where: { id: pendingTransaction.wallet_id }
          });
        }

        const paymentData = {
          status: 'failed',
          amount: pendingTransaction.amount,
          currency: 'KES',
          reference: pendingTransaction.reference,
          timestamp: new Date().toISOString(),
          message: `Payment failed: ${failureReason}`,
          wallet: wallet ? {
            balance_kes: wallet.kes_balance,
            balance_usd: wallet.usd_balance
          } : null,
          metadata: {
            resultCode,
            failureReason,
            checkoutRequestId,
            transactionId: pendingTransaction.id
          },
          userId: wallet ? wallet.user_id : null
        };

        // Broadcast via WebSocket (for Socket.IO clients)
        websocketService.broadcastPaymentUpdate(pendingTransaction.reference, paymentData);

        // Publish to Redis (for WebSocket clients using Redis pub/sub)
        await publishPaymentEvent(pendingTransaction.reference, paymentData);

        logger.info('Payment failure WebSocket broadcast sent:', {
          messageId: pendingTransaction.reference,
          failureReason
        });
      } catch (wsError) {
        logger.error('Failed to broadcast payment failure via WebSocket:', wsError);
        // Don't fail the callback if WebSocket fails
      }

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Callback received'
      });
    }

  } catch (error) {
    await dbTransaction.rollback();

    logger.error('STK Push callback processing error:', {
      error: error.message,
      stack: error.stack
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
