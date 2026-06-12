const crypto = require('crypto');
const { User } = require('../../models');
const logger = require('../../utils/logger');

const verifySignature = (req) => {
  const secret = process.env.MYSTOCKS_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if secret not configured

  const signature = req.headers['x-mystocks-signature'];
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

const handleWebhook = async (req, res) => {
  if (!verifySignature(req)) {
    logger.warn('MS webhook: invalid signature');
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  const { event, data } = req.body;

  logger.info(`MS webhook received: ${event}`, { subAccountId: data?.subAccountId });

  // Respond immediately — process async
  res.json({ success: true, received: true });

  try {
    switch (event) {
      case 'trade.settled': {
        logger.info(`MS trade settled: orderId=${data.orderId} symbol=${data.symbol} type=${data.type}`);
        break;
      }

      case 'trade.rejected': {
        logger.warn(`MS trade rejected: orderId=${data.orderId} reason=${data.rejectionReason}`);
        break;
      }

      case 'deposit.confirmed': {
        logger.info(`MS deposit confirmed: subAccountId=${data.subAccountId} amount=${data.amount} ${data.currency}`);
        break;
      }

      case 'withdraw.confirmed': {
        logger.info(`MS withdrawal confirmed: subAccountId=${data.subAccountId} amount=${data.amount}`);
        break;
      }

      case 'kyc.updated': {
        logger.info(`MS KYC updated: subAccountId=${data.subAccountId} status=${data.kycStatus} level=${data.kycLevel}`);
        // Sync KYC status back to our User record
        const user = await User.findOne({
          where: { mystocks_sub_account_id: data.subAccountId }
        });
        if (user) {
          await user.update({ kyc_status: data.kycStatus === 'VERIFIED' ? 'approved' : 'pending' });
        }
        break;
      }

      case 'account.frozen': {
        logger.warn(`MS account frozen: subAccountId=${data.subAccountId}`);
        const user = await User.findOne({
          where: { mystocks_sub_account_id: data.subAccountId }
        });
        if (user) {
          await user.update({ account_status: 'suspended' });
        }
        break;
      }

      case 'dividend.paid': {
        logger.info(`MS dividend paid: symbol=${data.symbol} perShare=${data.dividendPerShare}`);
        break;
      }

      case 'incident.declared': {
        logger.warn(`MS incident declared: ${data.title} severity=${data.severity}`);
        break;
      }

      case 'incident.resolved': {
        logger.info(`MS incident resolved: ${data.title}`);
        break;
      }

      default:
        logger.info(`MS webhook: unhandled event type: ${event}`);
    }
  } catch (error) {
    logger.error(`MS webhook processing error for event ${event}:`, error.message);
  }
};

module.exports = { handleWebhook };
