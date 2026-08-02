import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRoutes } from './src/routes/auth.js';
import { inwardRoutes } from './src/routes/inward.js';
import { outwardRoutes } from './src/routes/outward.js';
import { usersRoutes } from './src/routes/users.js';
import { lookupsRoutes } from './src/routes/lookups.js';
import { companiesRoutes } from './src/routes/companies.js';
import { reportsRoutes } from './src/routes/reports.js';
import { backupsRoutes } from './src/routes/backups.js';
import { companyBackupsRoutes } from './src/routes/company-backups.js';
import { housekeepingRoutes } from './src/routes/housekeeping.js';
import { scheduledPurge } from './src/services/housekeeping.js';
import { cleanupExpiredSessions } from './src/middleware/session.js';

const app = new Hono();

app.use('*', logger());

// CORS: simple origin echo. For production, replace with a whitelist check.
const allowedOrigins = []; // e.g. ['https://example.com'] or load from env/bindings
app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return '';
    if (allowedOrigins.length === 0) return origin;
    return allowedOrigins.includes(origin) ? origin : '';
  },
  credentials: true,
}));

app.onError((err, c) => {
  // Log server-side; avoid leaking stack to clients in production
  console.error('Unhandled error:', err);
  return c.json({ error: 'An unexpected error occurred. Please try again.' }, 500);
});

app.get('/api/health', async (c) => {
  try {
    if (!c.env || !c.env.DB) {
      return c.json({ status: 'unhealthy', database: 'missing' }, 503);
    }

    const prepare = c.env.DB.prepare?.bind(c.env.DB);
    let result = null;
    if (prepare) {
      try {
        const stmt = prepare('SELECT 1 AS ok');
        if (stmt && typeof stmt.first === 'function') {
          result = await stmt.first();
        } else {
          // Fallback: try direct .first() pattern
          result = await c.env.DB.prepare('SELECT 1 AS ok').first();
        }
      } catch (e) {
        // swallow and let outer handler return unhealthy
        console.error('DB health query failed:', e);
      }
    }

    const ok = result && (result.ok === 1 || result.ok === '1');
    if (ok) {
      return c.json({ status: 'healthy', database: 'connected', timestamp: new Date().toISOString() });
    }

    return c.json({ status: 'degraded', database: 'disconnected' }, 503);
  } catch (e) {
    console.error('Health check error:', e);
    return c.json({ status: 'unhealthy', database: 'error', error: String(e) }, 503);
  }
});

app.route('/api/auth', authRoutes);
app.route('/api/inward', inwardRoutes);
app.route('/api/outward', outwardRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/lookups', lookupsRoutes);
app.route('/api/companies', companiesRoutes);
app.route('/api/reports', reportsRoutes);
app.route('/api/backups', backupsRoutes);
app.route('/api/company-backups', companyBackupsRoutes);
app.route('/api/housekeeping', housekeepingRoutes);

app.get('*', (c) => {
  if (c.env && c.env.ASSETS) {
    const req = (c.req && c.req.raw) ? c.req.raw : c.req;
    return c.env.ASSETS.fetch(req);
  }
  // Fallback when ASSETS binding is not available
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Beam Veda</title>
</head>
<body style="font-family:system-ui,sans-serif;background:#f0f2f5;color:#333;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
  <div style="max-width:400px;padding:2rem;background:white;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <h1 style="color:#1e3a5f;margin-bottom:0.3rem;">Beam Veda</h1>
    <p style="color:#6b7280;font-size:0.85rem;margin-bottom:1rem;">Beam Pipe Stock Management</p>
    <p style="font-size:0.9rem;">The API is live at <code>/api/*</code>. The frontend assets need to be deployed.</p>
  </div>
</body>
</html>`);
});

// Export the Hono app as the default and scheduled as a named export.
export default app;

export const scheduled = async (event, env) => {
  if (event.cron === '0 4 * * *') {
    try { await scheduledPurge(env); } catch (err) { console.error('scheduledPurge error:', err); }
    try { await cleanupExpiredSessions(env); } catch (err) { console.error('cleanupExpiredSessions error:', err); }
  }
};
