// Company backups routes — replaces src/routes/company-backups.js
import { Hono } from 'hono';
import { requireAdmin, effectiveCompanyScope } from '../middleware/auth.js';
import {
  listCompanyBackups,
  listAllCompanyBackups,
  generateCompanyBackup,
  getCompanyBackupFile,
  deleteCompanyBackup,
  deleteCompanyBackupsOlderThan
} from '../services/backup.js';
import { restoreCompanyBackup } from '../services/restore.js';

const companyBackups = new Hono();

// GET /api/company-backups
companyBackups.get('/', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json(await listAllCompanyBackups(c.env));
  return c.json(await listCompanyBackups(c.env, scope.companyId));
});

// POST /api/company-backups/run
companyBackups.post('/run', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before running a company backup.' }, 400);
  try {
    const filename = await generateCompanyBackup(c.env, scope.companyId);
    return c.json({ ok: true, filename });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/company-backups/:filename/download
companyBackups.get('/:filename/download', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  let companyId = scope.companyId;
  if (scope.all) {
    companyId = parseInt(c.req.query('companyId'), 10);
    if (!companyId) return c.json({ error: 'companyId is required when viewing all companies.' }, 400);
  }
  const obj = await getCompanyBackupFile(c.env, companyId, c.req.param('filename'));
  if (!obj) return c.json({ error: 'Backup not found.' }, 404);
  const safe = c.req.param('filename').replace(/[^a-zA-Z0-9._-]/g, '');
  return new Response(await obj.text(), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${safe}"`,
    },
  });
});

// DELETE /api/company-backups/:filename
companyBackups.delete('/:filename', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  let companyId = scope.companyId;
  if (scope.all) {
    companyId = parseInt(c.req.query('companyId'), 10);
    if (!companyId) return c.json({ error: 'companyId is required when viewing all companies.' }, 400);
  }
  await deleteCompanyBackup(c.env, companyId, c.req.param('filename'));
  return c.json({ ok: true });
});

// POST /api/company-backups/cleanup
companyBackups.post('/cleanup', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before cleaning up backups.' }, 400);
  const { olderThanDays } = await c.req.json();
  const days = parseInt(olderThanDays, 10);
  if (!days || days <= 0) return c.json({ error: 'Enter a valid number of days.' }, 400);
  const removed = await deleteCompanyBackupsOlderThan(c.env, scope.companyId, days);
  return c.json({ ok: true, removed });
});

// POST /api/company-backups/:filename/restore — restore this company from a backup
companyBackups.post('/:filename/restore', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before restoring a backup.' }, 400);
  try {
    const result = await restoreCompanyBackup(c.env, scope.companyId, c.req.param('filename'));
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export { companyBackups as companyBackupsRoutes };
