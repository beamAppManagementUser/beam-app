// Outward routes — replaces src/routes/outward.js
import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { savePhoto, deletePhoto, getPhoto, parseMultipart, deviceInfoFromReq, servePhotoInline, servePhotoDownload } from '../utils/uploads.js';
import { shippedQty } from '../utils/balance.js';
import { logHistory } from '../db.js';

const outward = new Hono();

function canTouch(c, existing) {
  const session = c.get('session');
  return session.user.isRoot || existing.company_id === session.user.companyId;
}

function validateShipment(body, inwardEntry, alreadyShipped, excludeShipmentId) {
  const errors = {};
  const n = parseInt(body.number_of_pipes, 10);
  if (!n || n <= 0) errors.number_of_pipes = 'Enter a positive whole number';
  if (!body.outward_date) errors.outward_date = 'Required';
  if (!body.outward_vehicle_reg || !body.outward_vehicle_reg.trim()) errors.outward_vehicle_reg = 'Required';
  if (body.outward_date && inwardEntry && body.outward_date < inwardEntry.inward_date) {
    errors.outward_date = 'Cannot be before the inward date.';
  }
  if (!errors.number_of_pipes && inwardEntry) {
    const remaining = inwardEntry.number_of_pipes - alreadyShipped;
    if (n > remaining) {
      errors.number_of_pipes = `Only ${remaining} pipe(s) remaining on this inward entry (already shipped: ${alreadyShipped} of ${inwardEntry.number_of_pipes}).`;
    }
  }
  return errors;
}

outward.get('/:id/photo', requireLogin, async (c) => {
  const shipment = await c.env.DB.prepare('SELECT id, company_id, has_photo FROM outward_shipments WHERE id = ?').bind(c.req.param('id')).first();
  if (!shipment || !canTouch(c, shipment) || !shipment.has_photo) return c.notFound();
  return servePhotoInline(c, c.req.param('id'));
});

outward.get('/:id/photo/download', requireLogin, async (c) => {
  const shipment = await c.env.DB.prepare('SELECT id, company_id, has_photo FROM outward_shipments WHERE id = ?').bind(c.req.param('id')).first();
  if (!shipment || !canTouch(c, shipment) || !shipment.has_photo) return c.notFound();
  return servePhotoDownload(c, c.req.param('id'), `outward_${c.req.param('id')}`);
});

outward.post('/:inwardId', requireLogin, async (c) => {
  const inwardEntry = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE id = ?').bind(c.req.param('inwardId')).first();
  if (!inwardEntry || !canTouch(c, inwardEntry)) return c.json({ error: 'Inward entry not found.' }, 404);
  const { body, file } = await parseMultipart(c);
  const alreadyShipped = await shippedQty(c.env, inwardEntry.id, null);
  const errors = validateShipment(body, inwardEntry, alreadyShipped, null);
  if (Object.keys(errors).length) return c.json({ errors }, 400);
  const id = uuidv4();
  const now = new Date().toISOString();
  const device = deviceInfoFromReq(c);
  const session = c.get('session');
  await c.env.DB.prepare(`
    INSERT INTO outward_shipments (id, company_id, inward_id, pipe_number, number_of_pipes, outward_date, outward_vehicle_reg,
      notes, has_photo, created_by, created_at, updated_by, updated_at, device_info)
    VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?)
  `).bind(
    id, inwardEntry.company_id, inwardEntry.id, body.pipe_number ? body.pipe_number.trim() : null,
    parseInt(body.number_of_pipes, 10), body.outward_date, body.outward_vehicle_reg.trim(),
    body.notes ? body.notes.trim() : null,
    session.user.id, now, session.user.id, now, device
  ).run();
  if (file) {
    await savePhoto(c.env, id, file);
    await c.env.DB.prepare('UPDATE outward_shipments SET has_photo = 1 WHERE id = ?').bind(id).run();
  }
  const shipment = await c.env.DB.prepare('SELECT * FROM outward_shipments WHERE id = ?').bind(id).first();
  await logHistory(c.env, inwardEntry.company_id, inwardEntry.id, 'outward', id, 'create', session.user.id, device, shipment);
  return c.json({ ...shipment, hasPhoto: !!shipment.has_photo }, 201);
});

outward.put('/:id', requireAdmin, async (c) => {
  const existing = await c.env.DB.prepare('SELECT * FROM outward_shipments WHERE id = ?').bind(c.req.param('id')).first();
  if (!existing || !canTouch(c, existing)) return c.json({ error: 'Shipment not found.' }, 404);
  const inwardEntry = await c.env.DB.prepare('SELECT * FROM inward_entries WHERE id = ?').bind(existing.inward_id).first();
  const { body, file } = await parseMultipart(c);
  const alreadyShipped = await shippedQty(c.env, existing.inward_id, existing.id);
  const errors = validateShipment(body, inwardEntry, alreadyShipped, existing.id);
  if (Object.keys(errors).length) return c.json({ errors }, 400);
  const device = deviceInfoFromReq(c);
  const now = new Date().toISOString();
  const session = c.get('session');
  await c.env.DB.prepare(`
    UPDATE outward_shipments SET pipe_number=?, number_of_pipes=?, outward_date=?, outward_vehicle_reg=?,
      notes=?, updated_by=?, updated_at=?, device_info=?
    WHERE id=?
  `).bind(
    body.pipe_number ? body.pipe_number.trim() : null,
    parseInt(body.number_of_pipes, 10), body.outward_date, body.outward_vehicle_reg.trim(),
    body.notes ? body.notes.trim() : null,
    session.user.id, now, device, c.req.param('id')
  ).run();
  if (file) {
    await savePhoto(c.env, c.req.param('id'), file);
    await c.env.DB.prepare('UPDATE outward_shipments SET has_photo = 1 WHERE id = ?').bind(c.req.param('id')).run();
  }
  const shipment = await c.env.DB.prepare('SELECT * FROM outward_shipments WHERE id = ?').bind(c.req.param('id')).first();
  await logHistory(c.env, existing.company_id, existing.inward_id, 'outward', c.req.param('id'), 'update', session.user.id, device, shipment);
  return c.json({ ...shipment, hasPhoto: !!shipment.has_photo });
});

outward.delete('/:id', requireAdmin, async (c) => {
  const existing = await c.env.DB.prepare('SELECT * FROM outward_shipments WHERE id = ?').bind(c.req.param('id')).first();
  if (!existing || !canTouch(c, existing)) return c.json({ error: 'Shipment not found.' }, 404);
  const session = c.get('session');
  const device = deviceInfoFromReq(c);
  await logHistory(c.env, existing.company_id, existing.inward_id, 'outward', c.req.param('id'), 'delete', session.user.id, device, existing);
  await c.env.DB.prepare('DELETE FROM outward_shipments WHERE id = ?').bind(c.req.param('id')).run();
  await deletePhoto(c.env, c.req.param('id'));
  return c.json({ ok: true });
});

export { outward as outwardRoutes };
