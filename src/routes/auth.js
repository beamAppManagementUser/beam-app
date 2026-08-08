import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { createSession, destroySession, getSession, getSessionIdFromRequest, setSessionCookie, clearSessionCookie } from '../middleware/session.js';

// Configurable lockout policy
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function login(req, env, c) {
  try {
    const body = await req.json();
    const username = (body.username || body.id || '').trim();
    const password = body.password || '';
    const companyId = body.company_id || null;

    if (!username || !password) return new Response(JSON.stringify({ error: 'Missing credentials' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    // Look up user (case-insensitive usernames in DB)
    // allow root accounts (company_id IS NULL) or company-scoped users
    let userRow;
    if (companyId) {
      userRow = await env.DB.prepare('SELECT * FROM users WHERE company_id = ? AND username = ? COLLATE NOCASE').bind(companyId, username).first();
    }
    if (!userRow) {
      // fallback to global/root user if exists
      userRow = await env.DB.prepare('SELECT * FROM users WHERE company_id IS NULL AND username = ? COLLATE NOCASE').bind(username).first();
    }

    if (!userRow) {
      return new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // Check lockout
    if (userRow.locked_until) {
      const lockedUntil = new Date(userRow.locked_until).getTime();
      if (lockedUntil > Date.now()) {
        return new Response(JSON.stringify({ error: 'Account locked. Try again later.' }), { status: 423, headers: { 'Content-Type': 'application/json' } });
      }
    }

    const match = await bcrypt.compare(password, userRow.password_hash || '');
    if (!match) {
      // Increment failed_attempts and possibly lock
      const failed = (userRow.failed_attempts || 0) + 1;
      let lockedUntil = null;
      if (failed >= MAX_FAILED_ATTEMPTS) {
        lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
      }
      await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').bind(failed, lockedUntil, userRow.id).run();

      return new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // Successful login: reset failed attempts
    await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(userRow.id).run();

    // Create a session — normalize shape to match server expectations
    const sessionData = {
      user: {
        pk: userRow.pk ?? null,
        id: userRow.id,
        username: userRow.username,
        name: userRow.name || null,
        companyId: userRow.company_id ?? null,
        role: (userRow.role || 'employee').toString().toLowerCase(),
        isRoot: !!userRow.is_root
      },
      // For root users, selectedCompanyId === null means "all companies"; UI can update later
      selectedCompanyId: userRow.is_root ? null : (userRow.company_id ?? null)
    };

    const sessionId = await createSession(env, sessionData);

    // Set cookie
    setSessionCookie(c, sessionId, env);

    const responseBody = { id: userRow.id, username: userRow.username, name: userRow.name || null, company_id: userRow.company_id || null, role: userRow.role || 'employee' };
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Login error', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function logout(req, env, c) {
  try {
    const sessionId = getSessionIdFromRequest(c);
    if (sessionId) await destroySession(env, sessionId);
    clearSessionCookie(c, env);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Logout error', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function me(req, env, c) {
  try {
    const sessionId = getSessionIdFromRequest(c);
    if (!sessionId) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    const session = await getSession(env, sessionId);
    if (!session || !session.user) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(session.user), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Me error', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Create a Hono app instance for auth routes
const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  return login(c.req, c.env, c);
});

authRoutes.post('/logout', async (c) => {
  return logout(c.req, c.env, c);
});

authRoutes.get('/me', async (c) => {
  return me(c.req, c.env, c);
});

export { authRoutes };
