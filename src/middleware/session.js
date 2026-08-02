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
  // Hono: use header() accessor; guard if not available
  const cookieHeader = (c.req && typeof c.req.header === 'function') ? c.req.header('cookie') : (c.request && c.request.headers.get('cookie'));
  const cookie = cookieHeader || '';
  const match = cookie.match(/sid=([^;]+)/);
  if (match) return match[1];
  return null;
}

export function setSessionCookie(c, sessionId, { secure = true, path = '/' } = {}) {
  const cookie = `sid=${sessionId}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
  // Prefer appending Set-Cookie to avoid overwriting other cookies;
  // If Hono response headers support append, use that; otherwise fallback to header().
  try {
    if (c.res && c.res.headers && typeof c.res.headers.append === 'function') {
      c.res.headers.append('Set-Cookie', cookie);
    } else if (typeof c.header === 'function') {
      c.header('Set-Cookie', cookie);
    } else if (c.response && c.response.headers && typeof c.response.headers.append === 'function') {
      c.response.headers.append('Set-Cookie', cookie);
    } else {
      // Best effort: set on c.get/set pattern if available
      // (rare case; most environments above will work)
      console.warn('Could not append Set-Cookie header using known API; cookie may overwrite previous values.');
      if (typeof c.header === 'function') c.header('Set-Cookie', cookie);
    }
  } catch (e) {
    // Do not throw from cookie setter; log and continue
    console.error('setSessionCookie error:', e);
  }
}

export function clearSessionCookie(c, { path = '/' } = {}) {
  const cookie = `sid=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0`;
  try {
    if (c.res && c.res.headers && typeof c.res.headers.append === 'function') {
      c.res.headers.append('Set-Cookie', cookie);
    } else if (typeof c.header === 'function') {
      c.header('Set-Cookie', cookie);
    } else if (c.response && c.response.headers && typeof c.response.headers.append === 'function') {
      c.response.headers.append('Set-Cookie', cookie);
    } else {
      if (typeof c.header === 'function') c.header('Set-Cookie', cookie);
    }
  } catch (e) {
    console.error('clearSessionCookie error:', e);
  }
}

export async function cleanupExpiredSessions(env) {
  const now = new Date().toISOString();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
}
