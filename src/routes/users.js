// Users routes — replaces src/routes/users.js
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { requireAdmin, requireLogin, requireRoot, effectiveCompanyScope } from '../middleware/auth.js';
import { updateSession } from '../middleware/session.js';
import { isValidLanguage, getEffectiveLanguage, DEFAULT_ADMIN_LANG, DEFAULT_EMPLOYEE_LANG } from '../utils/languages.js';

const users = new Hono();

function safeUser(u, companyMeta) {
  return {
    pk: u.pk, id: u.id, name: u.name, role: u.role, active: !!u.active,
    createdAt: u.created_at,
    language: u.language || null,
    ...(companyMeta ? { companyName: u.company_name, companySlug: u.company_slug } : {}),
  };
}

users.put('/me/profile', requireLogin, async (c) => {
  const { name } = await c.req.json();
  if (!name || !name.trim()) return c.json({ error: 'Name cannot be empty.' }, 400);
  const session = c.get('session');
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE pk = ?').bind(name.trim(), session.user.pk).run();
  session.user.name = name.trim();
  await updateSession(c.env, c.get('sessionId'), session);
  return c.json({ ok: true, name: name.trim() });
});

users.put('/me/language', requireLogin, async (c) => {
  const { language } = await c.req.json();
  if (!language || !isValidLanguage(language)) return c.json({ error: 'Invalid language code.' }, 400);
  const session = c.get('session');
  await c.env.DB.prepare('UPDATE users SET language = ? WHERE pk = ?').bind(language, session.user.pk).run();
  session.user.language = language;
  await updateSession(c.env, c.get('sessionId'), session);
  return c.json({ ok: true, language });
});

users.get('/me/language', requireLogin, async (c) => {
  const session = c.get('session');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE pk = ?').bind(session.user.pk).first();
  let company = null;
  if (user.company_id) {
    company = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(user.company_id).first();
  }
  const effectiveLang = getEffectiveLanguage(user, company);
  return c.json({
    language: effectiveLang,
    personalPreference: user.language || null,
    companyDefault: user.role === 'admin' ? (company?.admin_default_lang || DEFAULT_ADMIN_LANG) : (company?.employee_default_lang || DEFAULT_EMPLOYEE_LANG),
  });
});

users.get('/', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  let rows;
  if (scope.all) {
    const result = await c.env.DB.prepare(`
      SELECT u.*, c.name AS company_name, c.slug AS company_slug
      FROM users u JOIN companies c ON c.id = u.company_id
      ORDER BY c.name ASC, u.created_at ASC
    `).all();
    rows = result.results || [];
    return c.json(rows.map(u => safeUser(u, true)));
  }
  const result = await c.env.DB.prepare('SELECT * FROM users WHERE company_id = ? ORDER BY created_at ASC').bind(scope.companyId).all();
  rows = result.results || [];
  return c.json(rows.map(u => safeUser(u, false)));
});

users.post('/', requireAdmin, async (c) => {
  const scope = effectiveCompanyScope(c);
  if (scope.all) return c.json({ error: 'Select a specific company before adding a user.' }, 400);
  const { id, name, password, role, language } = await c.req.json();
  if (!id || !name || !password || !role) return c.json({ error: 'All fields are required.' }, 400);
  if (!['admin', 'employee'].includes(role)) return c.json({ error: 'Invalid role.' }, 400);
  const existing = await c.env.DB.prepare('SELECT pk FROM users WHERE company_id = ? AND id = ?').bind(scope.companyId, id.trim()).first();
  if (existing) return c.json({ error: 'That User ID already exists in this company (User IDs are not case-sensitive).' }, 409);
  let userLang = null;
  if (language && isValidLanguage(language)) userLang = language;
  const info = await c.env.DB.prepare('INSERT INTO users (id, company_id, name, password_hash, role, active, is_root, created_at, language) VALUES (?,?,?,?,?,1,0,?,?)')
    .bind(id.trim(), scope.companyId, name.trim(), bcrypt.hashSync(password, 10), role, new Date().toISOString(), userLang).run();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE pk = ?').bind(info.meta.last_row_id).first();
  return c.json(safeUser(user), 201);
});

users.put('/:pk', requireAdmin, async (c) => {
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE pk = ?').bind(c.req.param('pk')).first();
  if (!user || user.is_root) return c.json({ error: 'User not found.' }, 404);
  const session = c.get('session');
  if (!session.user.isRoot && user.company_id !== session.user.companyId) return c.json({ error: 'That user is not part of your company.' }, 403);
  const { name, password, role, active, language } = await c.req.json();
  const newRole = role || user.role;
  const newActive = active === undefined ? !!user.active : !!active;
  if (user.role === 'admin' && (newRole !== 'admin' || !newActive)) {
    const remaining = await c.env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND role='admin' AND active=1 AND pk != ?").bind(user.company_id, user.pk).first();
    if (remaining.c === 0) return c.json({ error: "At least one active admin must remain for this company." }, 400);
  }
  let userLang = user.language;
  if (language !== undefined) userLang = (language && isValidLanguage(language)) ? language : null;
  await c.env.DB.prepare('UPDATE users SET name = ?, role = ?, active = ?, language = ? WHERE pk = ?').bind(name ? name.trim() : user.name, newRole, newActive ? 1 : 0, userLang, user.pk).run();
  if (password) {
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE pk = ?').bind(bcrypt.hashSync(password, 10), user.pk).run();
  }
  const updated = await c.env.DB.prepare('SELECT * FROM users WHERE pk = ?').bind(user.pk).first();
  return c.json(safeUser(updated));
});

users.delete('/:pk', requireAdmin, async (c) => {
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE pk = ?').bind(c.req.param('pk')).first();
  if (!user || user.is_root) return c.json({ error: 'User not found.' }, 404);
  const session = c.get('session');
  if (!session.user.isRoot && user.company_id !== session.user.companyId) return c.json({ error: 'That user is not part of your company.' }, 403);
  if (user.pk === session.user.pk) return c.json({ error: 'You cannot delete the account you are logged in as.' }, 400);
  if (user.role === 'admin') {
    const remaining = await c.env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND role='admin' AND active=1 AND pk != ?").bind(user.company_id, user.pk).first();
    if (remaining.c === 0) return c.json({ error: 'At least one active admin must remain for this company.' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM users WHERE pk = ?').bind(user.pk).run();
  return c.json({ ok: true });
});

users.get('/me/recovery-questions', requireLogin, async (c) => {
  const session = c.get('session');
  if (session.user.role !== 'admin') return c.json({ error: 'Security questions are only available to admin accounts.' }, 403);
  const rec = await c.env.DB.prepare('SELECT question1, question2, updated_at FROM admin_recovery WHERE user_pk = ?').bind(session.user.pk).first();
  return c.json(rec || { question1: '', question2: '', updated_at: null });
});

users.put('/me/recovery-questions', requireLogin, async (c) => {
  const session = c.get('session');
  if (session.user.role !== 'admin') return c.json({ error: 'Security questions are only available to admin accounts.' }, 403);
  const { question1, answer1, question2, answer2 } = await c.req.json();
  if (!question1 || !answer1 || !question2 || !answer2) return c.json({ error: 'Both questions and both answers are required.' }, 400);
  if (question1.trim() === question2.trim()) return c.json({ error: 'Please choose two different questions.' }, 400);
  const norm = (a) => a.trim().toLowerCase();
  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO admin_recovery (user_pk, question1, answer1_hash, question2, answer2_hash, updated_at, failed_attempts, locked_until)
    VALUES (?,?,?,?,?,?,0,NULL)
    ON CONFLICT(user_pk) DO UPDATE SET
      question1=excluded.question1, answer1_hash=excluded.answer1_hash,
      question2=excluded.question2, answer2_hash=excluded.answer2_hash,
      updated_at=excluded.updated_at, failed_attempts=0, locked_until=NULL
  `).bind(session.user.pk, question1.trim(), bcrypt.hashSync(norm(answer1), 10), question2.trim(), bcrypt.hashSync(norm(answer2), 10), now).run();
  return c.json({ ok: true });
});

users.put('/me/password-verified', requireRoot, async (c) => {
  const { answer1, answer2, newPassword } = await c.req.json();
  if (!newPassword || newPassword.length < 6) return c.json({ error: 'New password must be at least 6 characters.' }, 400);
  const session = c.get('session');
  const rec = await c.env.DB.prepare('SELECT * FROM admin_recovery WHERE user_pk = ?').bind(session.user.pk).first();
  if (!rec) return c.json({ error: 'Set up your security questions first (below), then you can change your password.' }, 400);
  if (rec.locked_until && new Date(rec.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(rec.locked_until).getTime() - Date.now()) / 60000);
    return c.json({ error: `Too many incorrect answers. Try again in ${mins} minute(s).` }, 423);
  }
  const norm = (a) => (a || '').trim().toLowerCase();
  const ok1 = bcrypt.compareSync(norm(answer1), rec.answer1_hash);
  const ok2 = bcrypt.compareSync(norm(answer2), rec.answer2_hash);
  if (!ok1 || !ok2) {
    const attempts = (rec.failed_attempts || 0) + 1;
    if (attempts >= 5) {
      const lockedUntil = new Date(Date.now() + 15 * 60000).toISOString();
      await c.env.DB.prepare('UPDATE admin_recovery SET failed_attempts = 0, locked_until = ? WHERE user_pk = ?').bind(lockedUntil, session.user.pk).run();
      return c.json({ error: 'Too many incorrect answers. Locked for 15 minutes.' }, 423);
    }
    await c.env.DB.prepare('UPDATE admin_recovery SET failed_attempts = ? WHERE user_pk = ?').bind(attempts, session.user.pk).run();
    return c.json({ error: `One or both answers are incorrect. ${5 - attempts} attempt(s) left before lockout.` }, 401);
  }
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE pk = ?').bind(bcrypt.hashSync(newPassword, 10), session.user.pk).run();
  await c.env.DB.prepare('UPDATE admin_recovery SET failed_attempts = 0, locked_until = NULL WHERE user_pk = ?').bind(session.user.pk).run();
  return c.json({ ok: true });
});

users.post('/:pk/reset-security-questions', requireAdmin, async (c) => {
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE pk = ?').bind(c.req.param('pk')).first();
  if (!user || user.is_root) return c.json({ error: 'User not found.' }, 404);
  const session = c.get('session');
  if (!session.user.isRoot && user.company_id !== session.user.companyId) return c.json({ error: 'That user is not part of your company.' }, 403);
  if (user.role !== 'admin') return c.json({ error: 'Security questions are only for admin accounts.' }, 400);
  await c.env.DB.prepare('DELETE FROM admin_recovery WHERE user_pk = ?').bind(user.pk).run();
  return c.json({ ok: true, message: 'Security questions reset. The user must set up new questions on next login.' });
});

export { users as usersRoutes };
