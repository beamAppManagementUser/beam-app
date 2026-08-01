// Housekeeping routes — purge management + settings
import { Hono } from 'hono';
import { requireAdmin, requireRoot, effectiveCompanyScope } from '../middleware/auth.js';
import { getSettings, updateSettings, previewPurge, executePurge } from '../services/housekeeping.js';

const housekeeping = new Hono();

housekeeping.get('/settings', requireAdmin, async (c) => {
  const settings = await getSettings(c.env);
  return c.json({
    purgeAllDays: settings.purge_all_days,
    purgeCompletedDays: settings.purge_completed_days,
    purgeAllEnabled: !!settings.purge_all_enabled,
    purgeCompletedEnabled: !!settings.purge_completed_enabled,
  });
});

housekeeping.put('/settings', requireRoot, async (c) => {
  const { purgeAllDays, purgeCompletedDays, purgeAllEnabled, purgeCompletedEnabled } = await c.req.json();
  const updates = {};
  if (purgeAllDays !== undefined) {
    const days = parseInt(purgeAllDays, 10);
    if (isNaN(days) || days < 1) return c.json({ error: 'purgeAllDays must be a positive number.' }, 400);
    updates.purge_all_days = days;
  }
  if (purgeCompletedDays !== undefined) {
    const days = parseInt(purgeCompletedDays, 10);
    if (isNaN(days) || days < 1) return c.json({ error: 'purgeCompletedDays must be a positive number.' }, 400);
    updates.purge_completed_days = days;
  }
  if (purgeAllEnabled !== undefined) updates.purge_all_enabled = purgeAllEnabled ? 1 : 0;
  if (purgeCompletedEnabled !== undefined) updates.purge_completed_enabled = purgeCompletedEnabled ? 1 : 0;
  const session = c.get('session');
  await updateSettings(c.env, updates, session.user.id);
  const settings = await getSettings(c.env);
  return c.json({
    purgeAllDays: settings.purge_all_days,
    purgeCompletedDays: settings.purge_completed_days,
    purgeAllEnabled: !!settings.purge_all_enabled,
    purgeCompletedEnabled: !!settings.purge_completed_enabled,
  });
});

housekeeping.get('/preview', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  const companyId = scope.all ? null : scope.companyId;
  const preview = await previewPurge(c.env, companyId);
  return c.json({ scope: scope.all ? 'all' : 'company', companyId: scope.companyId, ...preview });
});

housekeeping.post('/purge', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all && !c.get('session').user.isRoot) {
    return c.json({ error: 'Only root can purge across all companies.' }, 403);
  }
  const companyId = scope.all ? null : scope.companyId;
  const { mode } = await c.req.json();
  if (!['all', 'completed'].includes(mode)) return c.json({ error: 'Mode must be "all" or "completed".' }, 400);
  const session = c.get('session');
  const result = await executePurge(c.env, mode, companyId, session.user.id);
  return c.json({ mode, scope: scope.all ? 'all' : 'company', companyId: scope.companyId, ...result });
});

housekeeping.get('/stats', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  const companyId = scope.all ? null : scope.companyId;
  const settings = await getSettings(c.env);
  const preview = await previewPurge(c.env, companyId);
  const companyFilter = companyId ? 'WHERE company_id = ?' : '';
  const params = companyId ? [companyId] : [];
  const totalEntries = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM inward_entries ${companyFilter}`).bind(...params).first();
  const totalShipments = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM outward_shipments ${companyFilter}`).bind(...params).first();
  return c.json({
    scope: scope.all ? 'all' : 'company', companyId: scope.companyId,
    settings: { purgeAllDays: settings.purge_all_days, purgeCompletedDays: settings.purge_completed_days, purgeAllEnabled: !!settings.purge_all_enabled, purgeCompletedEnabled: !!settings.purge_completed_enabled },
    totals: { inwardEntries: totalEntries.c, outwardShipments: totalShipments.c },
    purgePreview: preview,
  });
});

export { housekeeping as housekeepingRoutes };
