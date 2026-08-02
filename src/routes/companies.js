// Companies routes — replaces src/routes/companies.js
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { requireRoot, requireAdmin } from '../middleware/auth.js';
import { savePhoto, getPhoto, deletePhoto, parseMultipart, deviceInfoFromReq } from '../utils/uploads.js';
import { isValidLanguage, DEFAULT_ADMIN_LANG, DEFAULT_EMPLOYEE_LANG } from '../utils/languages.js';
import { updateSession } from '../middleware/session.js';

const companies = new Hono();

const RESERVED_SLUGS = ['root-admin', 'api', 'uploads', 'static', 'assets', 'favicon.ico', 'manifest.json', 'sw.js', 'icon.svg', 'styles.css', 'app.js', 'i18n.js', 'index.html'];

function slugify(input) {
  return (input || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function validSlug(slug) {
  return /^[a-z0-9-]{2,60}$/.test(slug) && !RESERVED_SLUGS.includes(slug);
}
function companyPublic(c) {
  return {
    id: c.id, slug: c.slug, name: c.name, contact: c.contact, active: !!c.active, hasLogo: !!c.logo_path,
    adminDefaultLang: c.admin_default_lang || DEFAULT_ADMIN_LANG,
    employeeDefaultLang: c.employee_default_lang || DEFAULT_EMPLOYEE_LANG,
  };
}

companies.get('/public/:slug', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE slug = ? COLLATE NOCASE').bind(c.req.param('slug').trim()).first();
  if (!row || !row.active) return c.json({ error: 'Unknown or inactive company.' }, 404);
  return c.json(companyPublic(row));
});

companies.get('/public/:slug/logo', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE slug = ? COLLATE NOCASE').bind(c.req.param('slug').trim()).first();
  if (!row || !row.logo_path) return c.notFound();
  const obj = await c.env.BUCKETS.get(row.logo_path);
  if (!obj) return c.notFound();
  return new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg' } });
});

companies.get('/mine', requireAdmin, async (c) => {
  const session = c.get('session');
  if (!session.user.companyId) return c.json({ error: 'Root has no single company — use the Companies tab.' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(session.user.companyId).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  return c.json(companyPublic(row));
});

companies.put('/mine', requireAdmin, async (c) => {
  const session = c.get('session');
  if (!session.user.companyId) return c.json({ error: 'Root has no single company — use the Companies tab.' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(session.user.companyId).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  const { name, contact, employeeDefaultLang } = await c.req.json();
  let employeeLang = row.employee_default_lang || DEFAULT_EMPLOYEE_LANG;
  if (employeeDefaultLang !== undefined) {
    if (!isValidLanguage(employeeDefaultLang)) return c.json({ error: 'Invalid language code.' }, 400);
    employeeLang = employeeDefaultLang;
  }
  await c.env.DB.prepare('UPDATE companies SET name = ?, contact = ?, employee_default_lang = ? WHERE id = ?')
    .bind(name ? name.trim() : row.name, contact !== undefined ? contact : row.contact, employeeLang, row.id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(row.id).first();
  return c.json(companyPublic(updated));
});

companies.put('/mine/logo', requireAdmin, async (c) => {
  const session = c.get('session');
  if (!session.user.companyId) return c.json({ error: 'Root has no single company — use the Companies tab.' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(session.user.companyId).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  const { file } = await parseMultipart(c);
  if (!file) return c.json({ error: 'No logo file provided.' }, 400);
  const logoKey = `company-logos/${row.id}.jpg`;
  try {
    await c.env.BUCKETS.put(logoKey, file, { httpMetadata: { contentType: 'image/jpeg' } });
    await c.env.DB.prepare('UPDATE companies SET logo_path = ? WHERE id = ?').bind(logoKey, row.id).run();
  } catch (e) {
    console.error('Error saving logo:', e);
    return c.json({ error: 'Failed to save logo.' }, 500);
  }
  const updated = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(row.id).first();
  return c.json(companyPublic(updated));
});

companies.get('/', requireRoot, async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count,
      (SELECT COUNT(*) FROM inward_entries e WHERE e.company_id = c.id) AS record_count
    FROM companies c ORDER BY c.created_at ASC
  `).all();
  const rows = result.results || [];
  return c.json(rows.map(r => ({ ...companyPublic(r), userCount: r.user_count, recordCount: r.record_count })));
});

companies.post('/', requireRoot, async (c) => {
  const { name, slug: slugInput, contact, adminId, adminName, adminPassword, adminDefaultLang, employeeDefaultLang } = await c.req.json();
  if (!name || !name.trim()) return c.json({ error: 'Company name is required.' }, 400);
  const slug = slugify(slugInput || name);
  if (!validSlug(slug)) return c.json({ error: 'Invalid or reserved company slug. Use letters, numbers, and hyphens only.' }, 400);
  const existing = await c.env.DB.prepare('SELECT id FROM companies WHERE slug = ? COLLATE NOCASE').bind(slug).first();
  if (existing) return c.json({ error: 'That company slug is already in use.' }, 409);
  if (!adminId || !adminName || !adminPassword) {
    return c.json({ error: "The company's first admin (ID, name, password) is required when creating a company." }, 400);
  }
  const adminLang = adminDefaultLang && isValidLanguage(adminDefaultLang) ? adminDefaultLang : DEFAULT_ADMIN_LANG;
  const empLang = employeeDefaultLang && isValidLanguage(employeeDefaultLang) ? employeeDefaultLang : DEFAULT_EMPLOYEE_LANG;
  const now = new Date().toISOString();
  const info = await c.env.DB.prepare(
    'INSERT INTO companies (slug, name, contact, active, created_at, admin_default_lang, employee_default_lang) VALUES (?,?,?,1,?,?,?)'
  ).bind(slug, name.trim(), contact || '', now, adminLang, empLang).run();
  const companyId = info.meta.last_row_id;
  await c.env.DB.prepare('INSERT INTO users (id, company_id, name, password_hash, role, active, is_root, created_at) VALUES (?,?,?,?,?,1,0,?)')
    .bind(adminId.trim(), companyId, adminName.trim(), bcrypt.hashSync(adminPassword, 10), 'admin', now).run();
  const eligibleFields = [
    ['customer_number', 'Customer Number'], ['party_name', 'Party Name'], ['pipe_number', 'Pipe Number'],
    ['pipe_size', 'Pipe Size'], ['inward_vehicle_reg', 'Inward Vehicle Reg'], ['outward_vehicle_reg', 'Outward Vehicle Reg'],
  ];
  for (const [key, label] of eligibleFields) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO lookup_fields (company_id, field_key, label, use_lookup) VALUES (?,?,?,0)').bind(companyId, key, label).run();
  }
  const created = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(companyId).first();
  return c.json(companyPublic(created), 201);
});

companies.put('/:id', requireRoot, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  const { name, contact, adminDefaultLang, employeeDefaultLang } = await c.req.json();
  let adminLang = row.admin_default_lang || DEFAULT_ADMIN_LANG;
  let empLang = row.employee_default_lang || DEFAULT_EMPLOYEE_LANG;
  if (adminDefaultLang !== undefined) {
    if (!isValidLanguage(adminDefaultLang)) return c.json({ error: 'Invalid admin language code.' }, 400);
    adminLang = adminDefaultLang;
  }
  if (employeeDefaultLang !== undefined) {
    if (!isValidLanguage(employeeDefaultLang)) return c.json({ error: 'Invalid employee language code.' }, 400);
    empLang = employeeDefaultLang;
  }
  await c.env.DB.prepare('UPDATE companies SET name = ?, contact = ?, admin_default_lang = ?, employee_default_lang = ? WHERE id = ?')
    .bind(name ? name.trim() : row.name, contact !== undefined ? contact : row.contact, adminLang, empLang, row.id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(row.id).first();
  return c.json(companyPublic(updated));
});

companies.put('/:id/logo', requireRoot, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  const { file } = await parseMultipart(c);
  if (!file) return c.json({ error: 'No logo file provided.' }, 400);
  const logoKey = `company-logos/${row.id}.jpg`;
  try {
    await c.env.BUCKETS.put(logoKey, file, { httpMetadata: { contentType: 'image/jpeg' } });
    await c.env.DB.prepare('UPDATE companies SET logo_path = ? WHERE id = ?').bind(logoKey, row.id).run();
  } catch (e) {
    console.error('Error saving logo:', e);
    return c.json({ error: 'Failed to save logo.' }, 500);
  }
  const updated = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(row.id).first();
  return c.json(companyPublic(updated));
});

companies.post('/:id/deactivate', requireRoot, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  await c.env.DB.prepare('UPDATE companies SET active = 0 WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

companies.post('/:id/reactivate', requireRoot, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  await c.env.DB.prepare('UPDATE companies SET active = 1 WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

companies.delete('/:id', requireRoot, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  const { confirmSlug } = await c.req.json();
  if (!confirmSlug || confirmSlug.trim().toLowerCase() !== row.slug.toLowerCase()) {
    return c.json({ error: "Type the company's exact slug to confirm permanent deletion." }, 400);
  }
  const inwardIds = (await c.env.DB.prepare('SELECT id FROM inward_entries WHERE company_id = ?').bind(row.id).all()).results || [];
  const outwardIds = (await c.env.DB.prepare('SELECT id FROM outward_shipments WHERE company_id = ?').bind(row.id).all()).results || [];
  for (const r of [...inwardIds, ...outwardIds]) {
    try {
      await deletePhoto(c.env, r.id);
    } catch (e) {
      console.error('Failed to delete photo for id', r.id, e);
      // continue with deletion of db records even if photo deletion fails
    }
  }
  if (row.logo_path) {
    try {
      await c.env.BUCKETS.delete(row.logo_path);
    } catch (e) {
      console.error('Failed to delete logo from bucket:', e);
    }
  }
  await c.env.DB.prepare('DELETE FROM companies WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

companies.post('/select', requireRoot, async (c) => {
  const { companyId } = await c.req.json();
  const session = c.get('session');
  const sessionId = c.get('sessionId');
  if (companyId === null || companyId === undefined || companyId === '') {
    session.selectedCompanyId = null;
    await updateSession(c.env, sessionId, session);
    return c.json({ selected: null });
  }
  const row = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(companyId).first();
  if (!row) return c.json({ error: 'Company not found.' }, 404);
  session.selectedCompanyId = row.id;
  await updateSession(c.env, sessionId, session);
  return c.json({ selected: row.id });
});

export { companies as companiesRoutes };
