// Auth middleware — replaces src/middleware/auth.js
// Uses KV-based sessions instead of express-session

import { getSession, getSessionIdFromRequest } from './session.js';

async function loadSession(c) {
  const sessionId = getSessionIdFromRequest(c);
  if (!sessionId) return null;
  const session = await getSession(c.env, sessionId);
  if (!session) return null;
  c.set('session', session);
  c.set('sessionId', sessionId);
  return session;
}

export async function requireLogin(c, next) {
  const session = await loadSession(c);
  if (!session || !session.user) {
    return c.json({ error: 'Not logged in.' }, 401);
  }
  await next();
}

export async function requireAdmin(c, next) {
  const session = await loadSession(c);
  if (!session || !session.user) {
    return c.json({ error: 'Not logged in.' }, 401);
  }
  if (session.user.role !== 'admin') {
    return c.json({ error: 'Admin access required.' }, 403);
  }
  await next();
}

export async function requireRoot(c, next) {
  const session = await loadSession(c);
  if (!session || !session.user) {
    return c.json({ error: 'Not logged in.' }, 401);
  }
  if (!session.user.isRoot) {
    return c.json({ error: 'Root admin access required.' }, 403);
  }
  await next();
}

export function effectiveCompanyScope(c) {
  const session = c.get('session');
  const user = session?.user;
  if (!user) return { companyId: -1 };
  if (user.isRoot) {
    const selected = session.selectedCompanyId;
    if (selected === null || selected === undefined) return { companyId: null, all: true };
    return { companyId: selected };
  }
  return { companyId: user.companyId };
}
