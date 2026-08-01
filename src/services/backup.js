// Backup service — replaces src/services/backup.js
// Uses R2 for backup storage instead of local filesystem
// Cron triggers replace node-cron

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function checkpointAndBackup(env) {
  const tables = ['companies', 'users', 'admin_recovery', 'lookup_fields', 'lookup_values', 'inward_entries', 'outward_shipments', 'record_history'];
  const backup = {};
  for (const table of tables) {
    const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    backup[table] = result.results || [];
  }
  const filename = `beamstock_${timestamp()}.json`;
  await env.BUCKETS.put(`backups/system/${filename}`, JSON.stringify(backup, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  return filename;
}

export async function listBackups(env) {
  const list = await env.BUCKETS.list({ prefix: 'backups/system/' });
  const items = [];
  for (const obj of list.objects) {
    items.push({ filename: obj.key.replace('backups/system/', ''), sizeBytes: obj.size, createdAt: obj.uploaded.toISOString() });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteBackup(env, filename) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  await env.BUCKETS.delete(`backups/system/${safe}`);
}

export async function deleteBackupsOlderThan(env, days) {
  const backups = await listBackups(env);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const b of backups) {
    if (new Date(b.createdAt).getTime() < cutoff) { await deleteBackup(env, b.filename); removed++; }
  }
  return removed;
}

export async function getBackupFile(env, filename) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  return await env.BUCKETS.get(`backups/system/${safe}`);
}

export async function generateCompanyBackup(env, companyId) {
  const company = await env.DB.prepare('SELECT id, slug, name, contact FROM companies WHERE id = ?').bind(companyId).first();
  if (!company) throw new Error('Company not found.');
  const inwardEntries = (await env.DB.prepare('SELECT * FROM inward_entries WHERE company_id = ?').bind(companyId).all()).results || [];
  const outwardShipments = (await env.DB.prepare('SELECT * FROM outward_shipments WHERE company_id = ?').bind(companyId).all()).results || [];
  const lookupFields = (await env.DB.prepare('SELECT * FROM lookup_fields WHERE company_id = ?').bind(companyId).all()).results || [];
  const lookupValues = (await env.DB.prepare('SELECT * FROM lookup_values WHERE company_id = ?').bind(companyId).all()).results || [];
  const history = (await env.DB.prepare('SELECT * FROM record_history WHERE company_id = ? ORDER BY changed_at ASC').bind(companyId).all()).results || [];
  const parsedHistory = history.map((h) => ({ ...h, snapshot: JSON.parse(h.snapshot) }));
  const payload = {
    exportedAt: new Date().toISOString(),
    company: { slug: company.slug, name: company.name, contact: company.contact },
    note: "This export contains this company's inward entries, outward shipments, lookup lists, and audit history only. It does NOT include user accounts or passwords.",
    inwardEntries, outwardShipments, lookupFields, lookupValues, history: parsedHistory,
  };
  const filename = `company_${company.slug}_${timestamp()}.json`;
  await env.BUCKETS.put(`backups/companies/${companyId}/${filename}`, JSON.stringify(payload, null, 2), { httpMetadata: { contentType: 'application/json' } });
  return filename;
}

export async function listCompanyBackups(env, companyId) {
  const list = await env.BUCKETS.list({ prefix: `backups/companies/${companyId}/` });
  const items = [];
  for (const obj of list.objects) {
    items.push({ filename: obj.key.replace(`backups/companies/${companyId}/`, ''), sizeBytes: obj.size, createdAt: obj.uploaded.toISOString() });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listAllCompanyBackups(env) {
  const companies = (await env.DB.prepare('SELECT id, name FROM companies').all()).results || [];
  let all = [];
  for (const c of companies) {
    const items = (await listCompanyBackups(env, c.id)).map((b) => ({ ...b, companyId: c.id, companyName: c.name }));
    all = all.concat(items);
  }
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCompanyBackupFile(env, companyId, filename) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  return await env.BUCKETS.get(`backups/companies/${companyId}/${safe}`);
}

export async function deleteCompanyBackup(env, companyId, filename) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  await env.BUCKETS.delete(`backups/companies/${companyId}/${safe}`);
}

export async function deleteCompanyBackupsOlderThan(env, companyId, days) {
  const backups = await listCompanyBackups(env, companyId);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const b of backups) {
    if (new Date(b.createdAt).getTime() < cutoff) { await deleteCompanyBackup(env, companyId, b.filename); removed++; }
  }
  return removed;
}

export async function scheduledBackups(event, env) {
  if (event.cron === '0 2 * * 0') {
    try {
      const filename = await checkpointAndBackup(env);
      console.log('System backup created:', filename);
      const retentionDays = parseInt(env.BACKUP_RETENTION_DAYS || '0', 10);
      if (retentionDays > 0) {
        const removed = await deleteBackupsOlderThan(env, retentionDays);
        if (removed) console.log(`Removed ${removed} system backup(s) older than ${retentionDays} days.`);
      }
    } catch (e) { console.error('System backup failed:', e); }
  } else if (event.cron === '0 3 * * 0') {
    try {
      const companies = (await env.DB.prepare('SELECT id FROM companies WHERE active = 1').all()).results || [];
      const retentionDays = parseInt(env.COMPANY_BACKUP_RETENTION_DAYS || '0', 10);
      for (const c of companies) {
        try {
          const filename = await generateCompanyBackup(env, c.id);
          console.log(`Company backup created for company ${c.id}:`, filename);
          if (retentionDays > 0) {
            const removed = await deleteCompanyBackupsOlderThan(env, c.id, retentionDays);
            if (removed) console.log(`Removed ${removed} company backup(s) for company ${c.id} older than ${retentionDays} days.`);
          }
        } catch (e) { console.error(`Company backup failed for company ${c.id}:`, e); }
      }
    } catch (e) { console.error('Company backup scheduling run failed:', e); }
  }
}
