// Balance utilities — replaces src/utils/balance.js
// All functions are now async (D1 queries are async)
// N+1 fix: batch queries instead of per-entry lookups

export async function shippedQty(env, inwardId, excludeShipmentId) {
  let stmt;
  if (excludeShipmentId) {
    stmt = env.DB.prepare('SELECT COALESCE(SUM(number_of_pipes),0) AS s FROM outward_shipments WHERE inward_id = ? AND id != ?').bind(inwardId, excludeShipmentId);
  } else {
    stmt = env.DB.prepare('SELECT COALESCE(SUM(number_of_pipes),0) AS s FROM outward_shipments WHERE inward_id = ?').bind(inwardId);
  }
  const row = await stmt.first();
  return row?.s ?? 0;
}

export async function batchShippedQty(env, inwardIds) {
  if (!inwardIds || inwardIds.length === 0) return new Map();
  const placeholders = inwardIds.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT inward_id, COALESCE(SUM(number_of_pipes),0) AS shipped FROM outward_shipments WHERE inward_id IN (${placeholders}) GROUP BY inward_id`
  ).bind(...inwardIds).all();
  const map = new Map();
  for (const row of (result.results || [])) { map.set(row.inward_id, row.shipped); }
  return map;
}

export async function batchLastShipmentDates(env, inwardIds) {
  if (!inwardIds || inwardIds.length === 0) return new Map();
  const placeholders = inwardIds.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT inward_id, MAX(outward_date) AS last_date FROM outward_shipments WHERE inward_id IN (${placeholders}) GROUP BY inward_id`
  ).bind(...inwardIds).all();
  const map = new Map();
  for (const row of (result.results || [])) { map.set(row.inward_id, row.last_date); }
  return map;
}

export async function withBalance(env, entry) {
  const shipped = await shippedQty(env, entry.id);
  const remaining = entry.number_of_pipes - shipped;
  let status = 'open';
  if (shipped > 0 && remaining > 0) status = 'partial';
  if (remaining <= 0) status = 'closed';
  return { ...entry, hasPhoto: !!entry.has_photo, shippedQty: shipped, remainingQty: remaining, status };
}

export async function batchWithBalance(env, entries) {
  if (!entries || entries.length === 0) return [];
  const inwardIds = entries.map(e => e.id);
  const shippedMap = await batchShippedQty(env, inwardIds);
  return entries.map(entry => {
    const shipped = shippedMap.get(entry.id) || 0;
    const remaining = entry.number_of_pipes - shipped;
    let status = 'open';
    if (shipped > 0 && remaining > 0) status = 'partial';
    if (remaining <= 0) status = 'closed';
    return { ...entry, hasPhoto: !!entry.has_photo, shippedQty: shipped, remainingQty: remaining, status };
  });
}

export async function lastShipmentDate(env, inwardId) {
  const row = await env.DB.prepare('SELECT MAX(outward_date) AS d FROM outward_shipments WHERE inward_id = ?').bind(inwardId).first();
  return row?.d ?? null;
}
