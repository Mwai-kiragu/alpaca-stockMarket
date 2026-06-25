const logger = require('./logger');

// Lazy-load AuditLog to avoid circular require issues at startup
let AuditLog;
function getModel() {
  if (!AuditLog) AuditLog = require('../models/AuditLog');
  return AuditLog;
}

/**
 * Write an audit entry. Never throws — audit failures are logged but don't
 * crash the request.
 *
 * @param {object} opts
 * @param {string|null}  opts.actorId     - UUID of the acting user (null = system/anonymous)
 * @param {string}       opts.actorRole   - 'admin' | 'user' | 'system' | 'anonymous'
 * @param {string}       opts.action      - dot-namespaced action, e.g. 'kyc.approve'
 * @param {string|null}  opts.targetType  - entity type: 'user' | 'order' | 'wallet' | …
 * @param {string|null}  opts.targetId    - ID of affected entity
 * @param {object}       opts.details     - any extra context (serialised as JSONB)
 * @param {string|null}  opts.ip
 * @param {string|null}  opts.userAgent
 * @param {'success'|'failure'} opts.status
 * @param {string|null}  opts.errorMessage - original error message (for failures)
 * @param {'info'|'warning'|'error'} opts.severity
 */
async function audit(opts = {}) {
  try {
    const {
      actorId = null,
      actorRole = 'system',
      action,
      targetType = null,
      targetId = null,
      details = {},
      ip = null,
      userAgent = null,
      status = 'success',
      errorMessage = null,
      severity = 'info',
    } = opts;

    if (!action) return;

    await getModel().create({
      actorId,
      actorRole,
      action,
      targetType,
      targetId: targetId != null ? String(targetId) : null,
      details,
      ip,
      userAgent,
      status,
      errorMessage,
      severity,
    });
  } catch (err) {
    logger.error('Audit log write failed:', { message: err.message });
  }
}

/**
 * Extract common request context for audit entries.
 * Call as: const ctx = reqCtx(req);  then spread into audit({ ...ctx, ... })
 */
function reqCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.user?.role || 'anonymous',
    ip: (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
    userAgent: req.headers['user-agent'] || null,
  };
}

module.exports = { audit, reqCtx };
