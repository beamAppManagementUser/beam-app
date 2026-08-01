// Inward routes — replaces src/routes/inward.js
import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { requireLogin, requireAdmin, effectiveCompanyScope } from '../middleware/auth.js';
import { savePhoto, deletePhoto, getPhoto, parseMultipart, deviceInfoFromReq, servePhotoInline, servePhotoDownload } from '../utils/uploads.js';
import { shippedQty, batchWithBalance, batchLastShipmentDates } from '../utils/balance.js';
import { logHistory } from '../db.js';

const inward = new Hono();

function canTouch(c, existing) {
  const session = c.get('session');
  return session.user.isRoot || existing.company_id === session.user.companyId;
}

function validateEntry(body, scope) {
  const errors = {};
  if (!body.customer_number || !body.customer_number.trim()) errors.customer_number = 'Required';
  if (!body.party_name || !body.party_name.trim()) errors.party_name = 'Required';
  const n = parseInt(body.number_of_pipes, 10);
  if (!n || n <= 0) errors.number_of_pipes = 'Enter a positive whole number';
  if (!body.pipe_size || !body.pipe_size.trim()) errors.pipe_size = 'Required';
  if (!body.inward_date) errors.inward_date = 'Required';
  if (!body.inward_vehicle_reg || !body.inward_vehicle_reg.trim()) errors.inward_vehicle_reg = 'Required';
  return errors;
}

inward.get('/', requireLogin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before listing entries.' }, 400);
  const { from, to, status, q, page = 1, pageSize = 50 } = c.req.query();
  const pageNum = Math.max(1, parseInt(page, 10));
  const size = Math.min(200, Math.max(1, parseInt(pageSize, 10)));
  const offset = (pageNum - 1) * size;
  const clauses = ['e.company_id = ?'];
  const params = [scope.companyId];
  if (from) { clauses.push('e.inward_date >= ?'); params.push(from); }
  if (to) { clauses.push('e.inward_date <= ?'); params.push(to); }
  if (q) {
    clauses.push('(e.customer_number LIKE ? OR e.party_name LIKE ? OR e.pipe_number LIKE ? OR e.pipe_size LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.join(' AND ');
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM inward_entries e WHERE ${where}`).bind(...params).first();
  const total = countRow?.c ?? 0;
  const result = await c.env.DB.prepare(`SELECT * FROM inward_entries e WHERE ${where} ORDER BY e.inward_date DESC, e.created_at DESC LIMIT ? OFFSET ?`).bind(...params, size, offset).all();
  let rows = await batchWithBalance(c.env, result.results || []);
  if (status === 'open') rows = rows.filter(r => r.status === 'open');
  if (status === 'partial') rows = rows.filter(r => r.status === 'partial');
  if (status === 'closed') rows = rows.filter(r => r.status === 'closed');
  return c.json({ page: pageNum, pageSize: size, total, records: rows });
});

inward.get('/open', requireLogin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json([]);
  const result = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE company_id = ? ORDER BY inward_date DESC').bind(scope.companyId).all();
  const rows = await batchWithBalance(c.env, result.results || []);
  return c.json(rows.filter(r => r.status !== 'closed'));
});

inward.get('/:id', requireLogin, async (c) => {
  const entry = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE id = ?').bind(c.req.param('id')).first();
  if (!entry || !canTouch(c, entry)) return c.json({ error: 'Entry not found.' }, 404);
  const shipmentsResult = await c.env.DB.prepare('SELECT * FROM outward_shipments WHERE inward_id = ? ORDER BY outward_date ASC').bind(entry.id).all();
  const shipments = shipmentsResult.results || [];
  const shipped = await shippedQty(c.env, entry.id, null);
  const remaining = entry.number_of_pipes - shipped;
  let status = 'open';
  if (shipped > 0 && remaining > 0) status = 'partial';
  if (remaining <= 0) status = 'closed';
  return c.json({ ...entry, hasPhoto: !!entry.has_photo, shippedQty: shipped, remainingQty: remaining, status, shipments });
});

inward.get('/:id/history', requireLogin, async (c) => {
  const entry = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE id = ?').bind(c.req.param('id')).first();
  if (!entry || !canTouch(c, entry)) return c.json({ error: 'Entry not found.' }, 404);
  const result = await c.env.DB.prepare('SELECT * FROM record_history WHERE inward_id = ? ORDER BY changed_at DESC').bind(entry.id).all();
  const history = (result.results || []).map(h => ({ ...h, snapshot: JSON.parse(h.snapshot) }));
  return c.json(history);
});

inward.get('/:id/photo', requireLogin, async (c) => {
  const entry = await c.env.DB.prepare('SELECT id, company_id, has_photo FROM inward_entries WHERE id = ?').bind(c.req.param('id')).first();
  if (!entry || !canTouch(c, entry) || !entry.has_photo) return c.notFound();
  return servePhotoInline(c, c.req.param('id'));
});

inward.get('/:id/photo/download', requireLogin, async (c) => {
  const entry = await c.env.DB.prepare('SELECT id, company_id, has_photo FROM inward_entries WHERE id = ?').bind(c.req.param('id')).first();
  if (!entry || !canTouch(c, entry) || !entry.has_photo) return c.notFound();
  return servePhotoDownload(c, c.req.param('id'), `inward_${c.req.param('id')}`);
});

inward.post('/', requireLogin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before creating an entry.' }, 400);
  const { body, file } = await parseMultipart(c);
  const errors = validateEntry(body, scope);
  if (Object.keys(errors).length) return c.json({ errors }, 400);
  const id = uuidv4();
  const now = new Date().toISOString();
  const device = deviceInfoFromReq(c);
  const session = c.get('session');
  await c.env.DB.prepare(`
    INSERT INTO inward_entries (id, company_id, customer_number, party_name, pipe_number, number_of_pipes, pipe_size,
      inward_date, inward_vehicle_reg, notes, has_photo, created_by, created_at, updated_by, updated_at, device_info)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,NULL,?)
  `).bind(
    id, scope.companyId, body.customer_number.trim(), body.party_name.trim(),
    body.pipe_number ? body.pipe_number.trim() : null,
    parseInt(body.number_of_pipes, 10), body.pipe_size.trim(), body.inward_date,
    body.inward_vehicle_reg.trim(), body.notes ? body.notes.trim() : null,
    session.user.id, now, session.user.id, device
  ).run();
  if (file) {
    await savePhoto(c.env, id, file);
    await c.env.DB.prepare('UPDATE inward_entries SET has_photo = 1 WHERE id = ?').bind(id).run();
  }
  const entry = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE id = ?').bind(id).first();
  await logHistory(c.env, scope.companyId, id, 'inward', id, 'create', session.user.id, device, entry);
  return c.json({ ...entry, hasPhoto: !!entry.has_photo }, 201);
});

inward.put('/:id', requireAdmin, async (c) => {
  const existing = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE id = ?').bind(c.req.param('id')).first();
  if (!existing || !canTouch(c, existing)) return c.json({ error: 'Entry not found.' }, 404);
  const { body, file } = await parseMultipart(c);
  const errors = validateEntry(body, effectiveCompanyScope(c));
  if (Object.keys(errors).length) return c.json({ errors }, 400);
  const device = deviceInfoFromReq(c);
  const now = new Date().toISOString();
  const session = c.get('session');
  await c.env.DB.prepare(`
    UPDATE inward_entries SET customer_number=?, party_name=?, pipe_number=?, number_of_pipes=?, pipe_size=?,
      inward_date=?, inward_vehicle_reg=?, notes=?, updated_by=?, updated_at=?, device_info=?
    WHERE id=?
  `).bind(
    body.customer_number.trim(), body.party_name.trim(),
    body.pipe_number ? body.pipe_number.trim() : null,
    parseInt(body.number_of_pipes, 10), body.pipe_size.trim(), body.inward_date,
    body.inward_vehicle_reg.trim(), body.notes ? body.notes.trim() : null,
    session.user.id, now, device, c.req.param('id')
  ).run();
  if (file) {
    await savePhoto(c.env, c.req.param('id'), file);
    await c.env.DB.prepare('UPDATE inward_entries SET has_photo = 1 WHERE id = ?').bind(c.req.param('id')).run();
  }
  const entry = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE id = ?').bind(c.req.param('id')).first();
  await logHistory(c.env, existing.company_id, c.req.param('id'), 'inward', c.req.param('id'), 'update', session.user.id, device, entry);
  return c.json({ ...entry, hasPhoto: !!entry.has_photo });
});

inward.delete('/:id', requireAdmin, async (c) => {
  const existing = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE id = ?').bind(c.req.param('id')).first();
  if (!existing || !canTouch(c, existing)) return c.json({ error: 'Entry not found.' }, 404);
  const session = c.get('session');
  const device = deviceInfoFromReq(c);
  await logHistory(c.env, existing.company_id, c.req.param('id'), 'inward', c.req.param('id'), 'delete', session.user.id, device, existing);
  await c.env.DB.prepare('DELETE FROM outward_shipments WHERE inward_id = ?').bind(c.req.param('id')).run();
  await c.env.DB.prepare('DELETE FROM inward_entries WHERE id = ?').bind(c.req.param('id')).run();
  await deletePhoto(c.env, c.req.param('id'));
  return c.json({ ok: true });
});

export { inward as inwardRoutes };
