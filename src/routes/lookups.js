// Lookups routes — replaces src/routes/lookups.js
import { Hono } from 'hono';
import { requireLogin, requireAdmin, effectiveCompanyScope } from '../middleware/auth.js';

const lookups = new Hono();

lookups.get('/', requireLogin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json([]);

  const fieldsResult = await c.env.DB.prepare('SELECT * FROM lookup_fields WHERE company_id = ? ORDER BY label ASC').bind(scope.companyId).all();
  const valuesResult = await c.env.DB.prepare('SELECT * FROM lookup_values WHERE company_id = ? ORDER BY value ASC').bind(scope.companyId).all();
  const fields = fieldsResult.results || [];
  const values = valuesResult.results || [];
  const result = fields.map((f) => ({
    fieldKey: f.field_key,
    label: f.label,
    useLookup: !!f.use_lookup,
    values: values.filter((v) => v.field_key === f.field_key).map((v) => v.value),
  }));
  return c.json(result);
});

lookups.put('/fields/:fieldKey', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before editing lookups.' }, 400);
  const field = await c.env.DB.prepare('SELECT * FROM lookup_fields WHERE company_id = ? AND field_key = ?').bind(scope.companyId, c.req.param('fieldKey')).first();
  if (!field) return c.json({ error: 'Unknown field.' }, 404);
  const { useLookup } = await c.req.json();
  await c.env.DB.prepare('UPDATE lookup_fields SET use_lookup = ? WHERE company_id = ? AND field_key = ?')
    .bind(useLookup ? 1 : 0, scope.companyId, c.req.param('fieldKey')).run();
  return c.json({ ok: true });
});

lookups.post('/fields/:fieldKey/values', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before editing lookups.' }, 400);
  const field = await c.env.DB.prepare('SELECT * FROM lookup_fields WHERE company_id = ? AND field_key = ?').bind(scope.companyId, c.req.param('fieldKey')).first();
  if (!field) return c.json({ error: 'Unknown field.' }, 404);
  const { value } = await c.req.json();
  const trimmed = (value || '').trim();
  if (!trimmed) return c.json({ error: 'Value cannot be empty.' }, 400);
  try {
    await c.env.DB.prepare('INSERT INTO lookup_values (company_id, field_key, value) VALUES (?, ?, ?)').bind(scope.companyId, c.req.param('fieldKey'), trimmed).run();
  } catch (e) {
    if (!String(e.message).includes('UNIQUE')) return c.json({ error: 'Could not add value.' }, 500);
  }
  return c.json({ ok: true }, 201);
});

lookups.delete('/fields/:fieldKey/values/:value', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before editing lookups.' }, 400);
  await c.env.DB.prepare('DELETE FROM lookup_values WHERE company_id = ? AND field_key = ? AND value = ?')
    .bind(scope.companyId, c.req.param('fieldKey'), decodeURIComponent(c.req.param('value'))).run();
  return c.json({ ok: true });
});

export { lookups as lookupsRoutes };
