// Housekeeping service — purge old records based on configurable retention
import { deletePhoto } from '../utils/uploads.js';
import { logHistory } from '../db.js';

const DEFAULTS = { purge_all_days: 90, purge_completed_days: 30, purge_all_enabled: 1, purge_completed_enabled: 1 };

export async function getSettings(env) {
  const result = await env.DB.prepare('SELECT * FROM app_settings').all();
  const rows = result.results || [];
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    settings[row.key] = parseInt(row.value, 10);
  }
  return settings;
}

export async function updateSetting(env, key, value, updatedBy) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `).bind(key, String(value), now, updatedBy).run();
}

export async function updateSettings(env, updates, updatedBy) {
  for (const [key, value] of Object.entries(updates)) {
    await updateSetting(env, key, value, updatedBy);
  }
}

export async function previewPurge(env, companyId = null) {
  const settings = await getSettings(env);
  const allCutoff = new Date(Date.now() - settings.purge_all_days * 86400000).toISOString();
  const completedCutoff = new Date(Date.now() - settings.purge_completed_days * 86400000).toISOString();
  const companyFilter = companyId ? 'AND company_id = ?' : '';
  const params = companyId ? [companyId] : [];

  const allResult = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM inward_entries WHERE created_at < ? ${companyFilter}`
  ).bind(allCutoff, ...params).first();

  const completedResult = await env.DB.prepare(
    `SELECT e.id, e.number_of_pipes, e.company_id, e.has_photo,
       (SELECT COALESCE(SUM(number_of_pipes), 0) FROM outward_shipments WHERE inward_id = e.id) AS shipped
     FROM inward_entries e
     WHERE e.created_at < ? ${companyFilter}`
  ).bind(completedCutoff, ...params).all();

  const completedRows = (completedResult.results || []).filter(r => r.shipped >= r.number_of_pipes);

  const allIds = await env.DB.prepare(
    `SELECT id, has_photo FROM inward_entries WHERE created_at < ? ${companyFilter}`
  ).bind(allCutoff, ...params).all();
  const allPhotoCount = (allIds.results || []).filter(r => r.has_photo).length;

  return {
    all: { count: allResult.c, photos: allPhotoCount, cutoffDays: settings.purge_all_days, cutoffDate: allCutoff, enabled: !!settings.purge_all_enabled },
    completed: { count: completedRows.length, photos: completedRows.filter(r => r.has_photo).length, cutoffDays: settings.purge_completed_days, cutoffDate: completedCutoff, enabled: !!settings.purge_completed_enabled }
  };
}

export async function executePurge(env, mode, companyId, changedBy) {
  const settings = await getSettings(env);
  const days = mode === 'completed' ? settings.purge_completed_days : settings.purge_all_days;
  const enabledKey = mode === 'completed' ? 'purge_completed_enabled' : 'purge_all_enabled';
  const isEnabled = settings[enabledKey];
  if (!isEnabled) return { purged: 0, photosDeleted: 0, skipped: true, reason: 'This purge mode is disabled in settings.' };

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const companyFilter = companyId ? 'AND company_id = ?' : '';
  const params = companyId ? [companyId] : [];

  let entries;
  if (mode === 'all') {
    const result = await env.DB.prepare(`SELECT * FROM inward_entries WHERE created_at < ? ${companyFilter}`).bind(cutoff, ...params).all();
    entries = result.results || [];
  } else {
    const result = await env.DB.prepare(
      `SELECT e.*, (SELECT COALESCE(SUM(number_of_pipes), 0) FROM outward_shipments WHERE inward_id = e.id) AS shipped
       FROM inward_entries e WHERE e.created_at < ? ${companyFilter}`
    ).bind(cutoff, ...params).all();
    entries = (result.results || []).filter(r => r.shipped >= r.number_of_pipes);
  }

  let purged = 0;
  let photosDeleted = 0;
  for (const entry of entries) {
    await logHistory(env, entry.company_id, entry.id, 'inward', entry.id, 'delete', changedBy, 'housekeeping-purge', entry);
    if (entry.has_photo) { await deletePhoto(env, entry.id); photosDeleted++; }
    const shipments = await env.DB.prepare('SELECT id, has_photo FROM outward_shipments WHERE inward_id = ?').bind(entry.id).all();
    for (const s of (shipments.results || [])) {
      if (s.has_photo) { await deletePhoto(env, s.id); photosDeleted++; }
    }
    await env.DB.prepare('DELETE FROM inward_entries WHERE id = ?').bind(entry.id).run();
    purged++;
  }
  return { purged, photosDeleted, skipped: false };
}

export async function scheduledPurge(env) {
  const settings = await getSettings(env);
  if (settings.purge_completed_enabled) {
    try {
      const result = await executePurge(env, 'completed', null, 'system-cron');
      console.log(`[Housekeeping] Auto-purge (completed): ${result.purged} entries, ${result.photosDeleted} photos deleted.`);
    } catch (e) { console.error('[Housekeeping] Auto-purge (completed) failed:', e); }
  }
  if (settings.purge_all_enabled) {
    try {
      const result = await executePurge(env, 'all', null, 'system-cron');
      console.log(`[Housekeeping] Auto-purge (all): ${result.purged} entries, ${result.photosDeleted} photos deleted.`);
    } catch (e) { console.error('[Housekeeping] Auto-purge (all) failed:', e); }
  }
}
