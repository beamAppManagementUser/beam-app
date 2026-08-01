// Database utilities — replaces src/db.js
// D1 is accessed via env.DB binding (no file system, no pragmas)

export async function logHistory(env, companyId, inwardId, entityType, entityId, action, changedBy, deviceInfo, snapshot) {
  await env.DB.prepare(
    'INSERT INTO record_history (company_id, inward_id, entity_type, entity_id, action, changed_by, changed_at, device_info, snapshot) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(companyId, inwardId, entityType, entityId, action, changedBy, new Date().toISOString(), deviceInfo || '', JSON.stringify(snapshot)).run();
}
