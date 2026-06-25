const logger = require('../utils/logger');
const { audit, reqCtx } = require('../utils/auditLogger');

// Maps technical error names/codes to user-friendly messages
const FRIENDLY_MESSAGES = {
  JsonWebTokenError: 'Your session is invalid. Please log in again.',
  TokenExpiredError: 'Your session has expired. Please log in again.',
  CastError: 'The requested resource was not found.',
  SequelizeConnectionError: 'Service temporarily unavailable. Please try again shortly.',
  SequelizeConnectionRefusedError: 'Service temporarily unavailable. Please try again shortly.',
  SequelizeConnectionTimedOutError: 'The request timed out. Please try again.',
  SequelizeUniqueConstraintError: 'This record already exists.',
  SequelizeForeignKeyConstraintError: 'Cannot perform this action — related records exist.',
  SequelizeTimeoutError: 'Database request timed out. Please try again.',
};

function friendlyMessage(err) {
  if (FRIENDLY_MESSAGES[err.name]) return FRIENDLY_MESSAGES[err.name];
  if (err.code === 11000) return 'This record already exists.';
  if (err.name === 'ValidationError') {
    return Object.values(err.errors || {}).map(v => v.message).join(', ') || 'Validation failed.';
  }
  if (err.name === 'SequelizeValidationError') {
    return err.errors?.map(e => e.message).join(', ') || 'Validation failed.';
  }
  return null;
}

function httpStatus(err) {
  if (err.statusCode) return err.statusCode;
  if (err.status) return err.status;
  if (['JsonWebTokenError', 'TokenExpiredError'].includes(err.name)) return 401;
  if (err.name === 'CastError') return 404;
  if (['ValidationError', 'SequelizeValidationError', 'SequelizeUniqueConstraintError'].includes(err.name) || err.code === 11000) return 400;
  return 500;
}

const errorHandler = async (err, req, res, next) => {
  const status = httpStatus(err);
  const message = friendlyMessage(err) || (status < 500 ? err.message : 'An unexpected error occurred. Please try again.');

  logger.error(`${req.method} ${req.originalUrl} → ${status}: ${err.message}`, {
    stack: err.stack,
    ip: req.ip,
    user: req.user?.id,
  });

  // Persist user-facing errors (5xx + auth failures) to audit log
  if (status >= 400 && req.user?.id) {
    audit({
      ...reqCtx(req),
      action: 'app.error',
      targetType: 'request',
      targetId: req.originalUrl,
      details: {
        method: req.method,
        path: req.originalUrl,
        statusCode: status,
        errorName: err.name,
      },
      status: 'failure',
      errorMessage: err.message,
      severity: status >= 500 ? 'error' : 'warning',
    });
  }

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { debug: err.message, stack: err.stack }),
  });
};

module.exports = errorHandler;
