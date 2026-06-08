const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const logger = require('../utils/logger');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || '').replace(/\/$/, '');

/**
 * Upload a file buffer to Cloudflare R2.
 * @param {Buffer} buffer      File data from multer memoryStorage
 * @param {string} key         Object key, e.g. "kyc/user123/id_front.jpg"
 * @param {string} mimeType    e.g. "image/jpeg"
 * @returns {string}           Public URL of the uploaded file
 */
const uploadFile = async (buffer, key, mimeType) => {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType
  }));

  const url = `${PUBLIC_URL}/${key}`;
  logger.info(`R2 upload success: ${key}`);
  return url;
};

const deleteFile = async (key) => {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  logger.info(`R2 delete success: ${key}`);
};

const buildKey = (userId, docType, originalName) => {
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  return `kyc/${userId}/${docType}-${Date.now()}${ext}`;
};

module.exports = { uploadFile, deleteFile, buildKey };
