// Auth routes — replaces src/routes/auth.js
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { requireLogin } from '../middleware/auth.js';
import { createSession, destroySession, getSessionIdFromRequest, setSessionCookie, clearSessionCookie, updateSession } from '../middleware/session.js';
import { getEffectiveLanguage } from '../utils/languages.js';

const auth = new Hono();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function normalizeAnswer(a) {
  return (a || '').trim().toLowerCase();
}

function sessionShape(user) {
  return { pk: user.pk, id: user.id, name: user.name, role: user.role, isRoot: !!user.is_root, companyId: user.company_id || null, language: user.language || null };
}

auth.post('/login', async (c) => {
  const { id, password, companySlug } = await c.req.json();
  if (!id || !password) return c.json({ error: 'User ID and password are required.' }, 400);
  const env = c.env;
  let companyId = null;
  if (companySlug) {
    const company = await env.DB.prepare('SELECT * FROM companies WHERE slug = ? COLLATE NOCASE').bind(companySlug.trim()).first();
    if (!company || !company.active) return c.json({ error: 'Unknown or inactive company.' }, 404);
    companyId = company.id;
  }
  const user = companyId === null
    ? await env.DB.prepare('SELECT * FROM users WHERE company_id IS NULL AND id = ?').bind(id.trim()).first()
    : await env.DB.prepare('SELECT * FROM users WHERE company_id = ? AND id = ?').bind(companyId, id.trim()).first();
  if (!user || !user.active) return c.json({ error: 'Unknown user ID, or account disabled.' }, 401);
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    return c.json({ error: `Account temporarily locked after repeated failed attempts. Try again in ${mins} minute(s).` }, 423);
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    const attempts = (user.failed_attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
      await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE pk = ?').bind(lockedUntil, user.pk).run();
      return c.json({ error: `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.` }, 423);
    }
    await env.DB.prepare('UPDATE users SET failed_attempts = ? WHERE pk = ?').bind(attempts, user.pk).run();
    return c.json({ error: `Incorrect password. ${MAX_ATTEMPTS - attempts} attempt(s) left before lockout.` }, 401);
  }
  await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE pk = ?').bind(user.pk).run();
  const sessionData = { user: sessionShape(user), selectedCompanyId: null };
  const sessionId = await createSession(env, sessionData);
  setSessionCookie(c, sessionId);
  let company = null;
  if (user.company_id) {
    company = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(user.company_id).first();
  }
  const effectiveLang = getEffectiveLanguage(user, company);
  return c.json({ ...sessionData.user, selectedCompanyId: null, language: effectiveLang });
});

auth.post('/logout', async (c) => {
  const sessionId = getSessionIdFromRequest(c);
  await destroySession(c.env, sessionId);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.get('/me', requireLogin, async (c) => {
  const session = c.get('session');
  return c.json({ ...session.user, selectedCompanyId: session.user.isRoot ? (session.selectedCompanyId ?? null) : undefined });
});

auth.get('/recovery/:companySlug/:id/questions', async (c) => {
  const generic = { error: 'No security-question recovery is set up for this account. Contact another admin for a password reset.' };
  const env = c.env;
  const company = await env.DB.prepare('SELECT * FROM companies WHERE slug = ? COLLATE NOCASE').bind(c.req.param('companySlug').trim()).first();
  if (!company || !company.active) return c.json(generic, 404);
  const user = await env.DB.prepare('SELECT * FROM users WHERE company_id = ? AND id = ?').bind(company.id, c.req.param('id').trim()).first();
  if (!user || !user.active || user.role !== 'admin' || user.is_root) return c.json(generic, 404);
  const rec = await env.DB.prepare('SELECT * FROM admin_recovery WHERE user_pk = ?').bind(user.pk).first();
  if (!rec) return c.json(generic, 404);
  if (rec.locked_until && new Date(rec.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(rec.locked_until).getTime() - Date.now()) / 60000);
    return c.json({ error: `Too many incorrect answers. Try again in ${mins} minute(s).` }, 423);
  }
  return c.json({ question1: rec.question1, question2: rec.question2 });
});

auth.post('/recovery/:companySlug/:id/reset', async (c) => {
  const { answer1, answer2, newPassword } = await c.req.json();
  const generic = { error: 'No security-question recovery is set up for this account. Contact another admin for a password reset.' };
  const env = c.env;
  const company = await env.DB.prepare('SELECT * FROM companies WHERE slug = ? COLLATE NOCASE').bind(c.req.param('companySlug').trim()).first();
  if (!company || !company.active) return c.json(generic, 404);
  const user = await env.DB.prepare('SELECT * FROM users WHERE company_id = ? AND id = ?').bind(company.id, c.req.param('id').trim()).first();
  if (!user || !user.active || user.role !== 'admin' || user.is_root) return c.json(generic, 404);
  if (!newPassword || newPassword.length < 6) return c.json({ error: 'New password must be at least 6 characters.' }, 400);
  const rec = await env.DB.prepare('SELECT * FROM admin_recovery WHERE user_pk = ?').bind(user.pk).first();
  if (!rec) return c.json(generic, 404);
  if (rec.locked_until && new Date(rec.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(rec.locked_until).getTime() - Date.now()) / 60000);
    return c.json({ error: `Too many incorrect answers. Try again in ${mins} minute(s).` }, 423);
  }
  const ok1 = bcrypt.compareSync(normalizeAnswer(answer1), rec.answer1_hash);
  const ok2 = bcrypt.compareSync(normalizeAnswer(answer2), rec.answer2_hash);
  if (!ok1 || !ok2) {
    const attempts = (rec.failed_attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
      await env.DB.prepare('UPDATE admin_recovery SET failed_attempts = 0, locked_until = ? WHERE user_pk = ?').bind(lockedUntil, user.pk).run();
      return c.json({ error: `Too many incorrect answers. Locked for ${LOCK_MINUTES} minutes.` }, 423);
    }
    await env.DB.prepare('UPDATE admin_recovery SET failed_attempts = ? WHERE user_pk = ?').bind(attempts, user.pk).run();
    return c.json({ error: `One or both answers are incorrect. ${MAX_ATTEMPTS - attempts} attempt(s) left before lockout.` }, 401);
  }
  await env.DB.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE pk = ?')
    .bind(bcrypt.hashSync(newPassword, 10), user.pk).run();
  await env.DB.prepare('UPDATE admin_recovery SET failed_attempts = 0, locked_until = NULL WHERE user_pk = ?').bind(user.pk).run();
  return c.json({ ok: true });
});

export { auth as authRoutes };
