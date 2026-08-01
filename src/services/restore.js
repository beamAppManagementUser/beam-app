// Backup restore service — restores data from a JSON backup in R2
import { getBackupFile, getCompanyBackupFile } from './backup.js';

export async function restoreFromBackup(env, filename) {
  const obj = await getBackupFile(env, filename);
  if (!obj) throw new Error('Backup not found.');
  const text = await obj.text();
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error('Invalid backup file — could not parse JSON.'); }

  const tables = ['companies', 'users', 'admin_recovery', 'lookup_fields', 'lookup_values', 'inward_entries', 'outward_shipments', 'record_history'];
  let totalRows = 0;
  for (const table of [...tables].reverse()) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  for (const table of tables) {
    const rows = backup[table] || [];
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(',');
    const insertSql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
    for (const row of rows) {
      const values = columns.map(col => row[col]);
      await env.DB.prepare(insertSql).bind(...values).run();
      totalRows++;
    }
  }
  return { tables: tables.length, rows: totalRows };
}

export async function restoreCompanyBackup(env, companyId, filename) {
  const obj = await getCompanyBackupFile(env, companyId, filename);
  if (!obj) throw new Error('Company backup not found.');
  const text = await obj.text();
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error('Invalid backup file — could not parse JSON.'); }
  const company = await env.DB.prepare('SELECT id FROM companies WHERE id = ?').bind(companyId).first();
  if (!company) throw new Error('Company not found.');

  await env.DB.prepare('DELETE FROM outward_shipments WHERE company_id = ?').bind(companyId).run();
  await env.DB.prepare('DELETE FROM inward_entries WHERE company_id = ?').bind(companyId).run();
  await env.DB.prepare('DELETE FROM record_history WHERE company_id = ?').bind(companyId).run();
  await env.DB.prepare('DELETE FROM lookup_values WHERE company_id = ?').bind(companyId).run();
  await env.DB.prepare('DELETE FROM lookup_fields WHERE company_id = ?').bind(companyId).run();

  let counts = { inwardEntries: 0, outwardShipments: 0, lookupFields: 0, lookupValues: 0, history: 0 };
  for (const f of (backup.lookupFields || [])) {
    await env.DB.prepare('INSERT OR IGNORE INTO lookup_fields (company_id, field_key, label, use_lookup) VALUES (?,?,?,?)').bind(companyId, f.field_key, f.label, f.use_lookup).run();
    counts.lookupFields++;
  }
  for (const v of (backup.lookupValues || [])) {
    await env.DB.prepare('INSERT OR IGNORE INTO lookup_values (company_id, field_key, value) VALUES (?,?,?)').bind(companyId, v.field_key, v.value).run();
    counts.lookupValues++;
  }
  for (const e of (backup.inwardEntries || [])) {
    await env.DB.prepare(`INSERT INTO inward_entries (id, company_id, customer_number, party_name, pipe_number, number_of_pipes, pipe_size,
      inward_date, inward_vehicle_reg, notes, has_photo, created_by, created_at, updated_by, updated_at, device_info)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(e.id, companyId, e.customer_number, e.party_name, e.pipe_number, e.number_of_pipes, e.pipe_size, e.inward_date, e.inward_vehicle_reg, e.notes, e.has_photo, e.created_by, e.created_at, e.updated_by, e.updated_at, e.device_info).run();
    counts.inwardEntries++;
  }
  for (const s of (backup.outwardShipments || [])) {
    await env.DB.prepare(`INSERT INTO outward_shipments (id, company_id, inward_id, pipe_number, number_of_pipes, outward_date, outward_vehicle_reg,
      notes, has_photo, created_by, created_at, updated_by, updated_at, device_info)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(s.id, companyId, s.inward_id, s.pipe_number, s.number_of_pipes, s.outward_date, s.outward_vehicle_reg, s.notes, s.has_photo, s.created_by, s.created_at, s.updated_by, s.updated_at, s.device_info).run();
    counts.outwardShipments++;
  }
  for (const h of (backup.history || [])) {
    await env.DB.prepare(`INSERT INTO record_history (company_id, inward_id, entity_type, entity_id, action, changed_by, changed_at, device_info, snapshot)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(companyId, h.inward_id, h.entity_type, h.entity_id, h.action, h.changed_by, h.changed_at, h.device_info, typeof h.snapshot === 'string' ? h.snapshot : JSON.stringify(h.snapshot)).run();
    counts.history++;
  }
  return counts;
}
