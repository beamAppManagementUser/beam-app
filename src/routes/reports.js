// Reports routes — replaces src/routes/reports.js
import { Hono } from 'hono';
import { requireAdmin, effectiveCompanyScope } from '../middleware/auth.js';
import { sendReportEmail } from '../services/email.js';
import { batchWithBalance, batchLastShipmentDates } from '../utils/balance.js';

const reports = new Hono();

async function buildFiltered(env, query, scope) {
  const { from, to, status } = query;
  const clauses = [];
  const params = [];
  if (!scope.all) { clauses.push('e.company_id = ?'); params.push(scope.companyId); }
  if (from) { clauses.push('e.inward_date >= ?'); params.push(from); }
  if (to) { clauses.push('e.inward_date <= ?'); params.push(to); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const join = scope.all ? 'JOIN companies c ON c.id = e.company_id' : '';
  const selectCompany = scope.all ? ', c.name AS company_name' : '';
  const result = await env.DB.prepare(`SELECT e.* ${selectCompany} FROM inward_entries e ${join} ${where} ORDER BY e.inward_date DESC`).bind(...params).all();
  let rows = await batchWithBalance(env, result.results || []);
  if (status === 'open') rows = rows.filter(r => r.status === 'open');
  if (status === 'partial') rows = rows.filter(r => r.status === 'partial');
  if (status === 'closed') rows = rows.filter(r => r.status === 'closed');
  return rows;
}

function toCsv(rows, withCompany) {
  const header = [
    ...(withCompany ? ['Company'] : []),
    'Customer Number','Party Name','Pipe Number','Inward Qty','Pipe Size','Inward Date','Inward Vehicle','Notes',
    'Shipped Qty','Remaining Qty','Last Outward Date','Status','Created By','Created At','Updated By','Updated At',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const row = [
      ...(withCompany ? [r.company_name || ''] : []),
      r.customer_number, r.party_name, r.pipe_number || '', r.number_of_pipes, r.pipe_size,
      r.inward_date, r.inward_vehicle_reg, r.notes || '',
      r.shippedQty, r.remainingQty, '',
      r.status.charAt(0).toUpperCase() + r.status.slice(1),
      r.created_by, r.created_at, r.updated_by, r.updated_at,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

reports.get('/', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  const rows = await buildFiltered(c.env, c.req.query(), scope);
  const totalPipesInward = rows.reduce((s, r) => s + r.number_of_pipes, 0);
  const totalShipped = rows.reduce((s, r) => s + r.shippedQty, 0);
  const open = rows.filter(r => r.status === 'open').length;
  const partial = rows.filter(r => r.status === 'partial').length;
  const closed = rows.filter(r => r.status === 'closed').length;
  return c.json({ count: rows.length, totalPipesInward, totalShipped, open, partial, closed, records: rows });
});

reports.get('/csv', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  const rows = await buildFiltered(c.env, c.req.query(), scope);
  const csv = toCsv(rows, scope.all);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="beam_stock_report_${date}.csv"`,
    },
  });
});

reports.post('/email', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  const { to, from, toDate, status } = await c.req.json();
  if (!to || !to.trim()) return c.json({ error: 'At least one recipient email is required.' }, 400);
  const rows = await buildFiltered(c.env, { from, to: toDate, status }, scope);
  const csv = toCsv(rows, scope.all);
  const filename = `beam_stock_report_${new Date().toISOString().slice(0, 10)}.csv`;
  try {
    await sendReportEmail(c.env, {
      to: to.split(',').map(s => s.trim()).filter(Boolean).join(','),
      subject: `Beam Stock Report — ${new Date().toLocaleDateString()}`,
      text: `Attached is the beam stock report (${rows.length} inward entrie(s)).\n\nScope: ${scope.all ? 'All companies' : 'Selected company'}. Filters — From: ${from || 'any'}, To: ${toDate || 'any'}, Status: ${status || 'all'}.`,
      csvContent: csv,
      csvFilename: filename,
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export { reports as reportsRoutes };
