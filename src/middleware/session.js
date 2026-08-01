// Session management using D1 instead of KV
// D1 allows 5 million writes/day on free tier vs KV's 1,000/day

const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

export async function createSession(env, sessionData) {
  const sessionId = crypto.randomUUID();
  const key = sessionId;
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)')
    .bind(key, JSON.stringify(sessionData), expiresAt).run();
  return sessionId;
}

export async function getSession(env, sessionId) {
  if (!sessionId) return null;
  const row = await env.DB.prepare('SELECT data, expires_at FROM sessions WHERE id = ?').bind(sessionId).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    return null;
  }
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export async function updateSession(env, sessionId, sessionData) {
  if (!sessionId) return;
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare('UPDATE sessions SET data = ?, expires_at = ? WHERE id = ?')
    .bind(JSON.stringify(sessionData), expiresAt, sessionId).run();
}

export async function destroySession(env, sessionId) {
  if (!sessionId) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export function getSessionIdFromRequest(c) {
  const cookie = c.req.header('cookie') || '';
  const match = cookie.match(/sid=([^;]+)/);
  if (match) return match[1];
  return null;
}

export function setSessionCookie(c, sessionId) {
  c.header('Set-Cookie', `sid=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`);
}

export function clearSessionCookie(c) {
  c.header('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export async function cleanupExpiredSessions(env) {
  const now = new Date().toISOString();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
}
