// Backups routes — replaces src/routes/backups.js
import { Hono } from 'hono';
import { requireRoot } from '../middleware/auth.js';
import { listBackups, checkpointAndBackup, deleteBackup, deleteBackupsOlderThan, getBackupFile } from '../services/backup.js';
import { restoreFromBackup } from '../services/restore.js';

const backups = new Hono();

// GET /api/backups
backups.get('/', requireRoot, async (c) => {
  const items = await listBackups(c.env);
  return c.json(items);
});

// POST /api/backups/run
backups.post('/run', requireRoot, async (c) => {
  const filename = await checkpointAndBackup(c.env);
  return c.json({ ok: true, filename });
});

// GET /api/backups/:filename/download
backups.get('/:filename/download', requireRoot, async (c) => {
  const safe = c.req.param('filename').replace(/[^a-zA-Z0-9._-]/g, '');
  const obj = await getBackupFile(c.env, safe);
  if (!obj) return c.json({ error: 'Backup not found.' }, 404);
  return new Response(await obj.text(), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${safe}"`,
    },
  });
});

// DELETE /api/backups/:filename
backups.delete('/:filename', requireRoot, async (c) => {
  await deleteBackup(c.env, c.req.param('filename'));
  return c.json({ ok: true });
});

// POST /api/backups/cleanup
backups.post('/cleanup', requireRoot, async (c) => {
  const { olderThanDays } = await c.req.json();
  const days = parseInt(olderThanDays, 10);
  if (!days || days <= 0) return c.json({ error: 'Provide a positive number of days.' }, 400);
  const removed = await deleteBackupsOlderThan(c.env, days);
  return c.json({ ok: true, removed });
});

// POST /api/backups/:filename/restore — restore from a system backup (root only)
backups.post('/:filename/restore', requireRoot, async (c) => {
  const safe = c.req.param('filename').replace(/[^a-zA-Z0-9._-]/g, '');
  try {
    const result = await restoreFromBackup(c.env, safe);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export { backups as backupsRoutes };
