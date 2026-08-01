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
import { scheduledBackups } from './src/services/backup.js';
import { scheduledPurge } from './src/services/housekeeping.js';
import { cleanupExpiredSessions } from './src/middleware/session.js';

const app = new Hono();

app.use('*', logger());

app.use('/api/*', cors({
  origin: (origin) => origin || null,
  credentials: true,
}));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'An unexpected error occurred. Please try again.' }, 500);
});

app.get('/api/health', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT 1 AS ok').first();
    if (result && result.ok === 1) {
      return c.json({ status: 'healthy', database: 'connected', timestamp: new Date().toISOString() });
    }
    return c.json({ status: 'degraded', database: 'disconnected' }, 503);
  } catch (e) {
    return c.json({ status: 'unhealthy', database: 'error', error: e.message }, 503);
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
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  ...app,
  scheduled: async (event, env) => {
    if (event.cron === '0 2 * * 0') {
      await scheduledBackups(event, env);
    }
    if (event.cron === '0 3 * * 0') {
      await scheduledBackups(event, env);
    }
    if (event.cron === '0 4 * * *') {
      await scheduledPurge(env);
      await cleanupExpiredSessions(env);
    }
  },
};
