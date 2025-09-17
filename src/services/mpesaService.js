const axios = require('axios');
const logger = require('../utils/logger');

class MpesaService {
  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.passkey = process.env.MPESA_PASSKEY;
    this.shortcode = process.env.MPESA_SHORTCODE;
    this.callbackUrl = process.env.MPESA_CALLBACK_URL;
    this.baseUrl = 'https://sandbox.safaricom.co.ke';
  }

  async getAccessToken() {
    try {
      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');

      const response = await axios.get(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });

      return response.data.access_token;
    } catch (error) {
      logger.error('MPesa access token error:', error.response?.data || error.message);
      throw new Error('Failed to get MPesa access token');
    }
  }

  generatePassword() {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').substr(0, 14);
    const password = Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString('base64');
    return { password, timestamp };
  }

  async initiateSTKPush(phone, amount, reference, description = 'Trading Platform Deposit') {
    try {
      const accessToken = await this.getAccessToken();
      const { password, timestamp } = this.generatePassword();

      const formattedPhone = phone.startsWith('0') ? `254${phone.substring(1)}` : phone;

      const requestData = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: this.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: `${this.callbackUrl}/${reference}`,
        AccountReference: reference,
        TransactionDesc: description
      };

      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('MPesa STK Push initiated:', {
        phone: formattedPhone,
        amount,
        reference,
        checkoutRequestId: response.data.CheckoutRequestID
      });

      return {
        success: true,
        checkoutRequestId: response.data.CheckoutRequestID,
        customerMessage: response.data.CustomerMessage,
        merchantRequestId: response.data.MerchantRequestID
      };
    } catch (error) {
      logger.error('MPesa STK Push error:', error.response?.data || error.message);
      throw new Error('Failed to initiate MPesa payment');
    }
  }

  async querySTKStatus(checkoutRequestId) {
    try {
      const accessToken = await this.getAccessToken();
      const { password, timestamp } = this.generatePassword();

      const requestData = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };

      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpushquery/v1/query`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      logger.error('MPesa STK Query error:', error.response?.data || error.message);
      throw new Error('Failed to query MPesa payment status');
    }
  }

  async processCallback(callbackData) {
    try {
      const { Body } = callbackData;
      const { stkCallback } = Body;

      const result = {
        merchantRequestId: stkCallback.MerchantRequestID,
        checkoutRequestId: stkCallback.CheckoutRequestID,
        resultCode: stkCallback.ResultCode,
        resultDesc: stkCallback.ResultDesc
      };

      if (stkCallback.ResultCode === 0) {
        const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
        const metadataObj = {};

        callbackMetadata.forEach(item => {
          switch (item.Name) {
            case 'Amount':
              metadataObj.amount = item.Value;
              break;
            case 'MpesaReceiptNumber':
              metadataObj.mpesaReceiptNumber = item.Value;
              break;
            case 'TransactionDate':
              metadataObj.transactionDate = item.Value;
              break;
            case 'PhoneNumber':
              metadataObj.phoneNumber = item.Value;
              break;
          }
        });

        result.metadata = metadataObj;
        result.success = true;
      } else {
        result.success = false;
      }

      return result;
    } catch (error) {
      logger.error('MPesa callback processing error:', error);
      throw new Error('Failed to process MPesa callback');
    }
  }
}

module.exports = new MpesaService();