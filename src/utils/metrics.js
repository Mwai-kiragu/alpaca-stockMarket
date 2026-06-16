const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({ register, prefix: 'riven_' });

const httpRequestDuration = new client.Histogram({
  name: 'riven_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'riven_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const activeConnections = new client.Gauge({
  name: 'riven_active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

const requestDurationMiddleware = (req, res, next) => {
  const end = httpRequestDuration.startTimer();
  activeConnections.inc();

  res.on('finish', () => {
    const route = req.route?.path || req.path || 'unknown';
    const labels = { method: req.method, route, status_code: res.statusCode };
    end(labels);
    httpRequestTotal.inc(labels);
    activeConnections.dec();
  });

  next();
};

module.exports = { register, requestDurationMiddleware };
