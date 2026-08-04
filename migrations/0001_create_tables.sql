-- migrations/0001_create_tables.sql
PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  slug TEXT UNIQUE,
  logo_url TEXT,
  contact_info TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER,
  username TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT,
  email TEXT COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'employee', -- 'root','admin','employee'
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users(company_id, username);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

CREATE TABLE IF NOT EXISTS inward_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  reference TEXT,
  number_of_pipes INTEGER NOT NULL DEFAULT 0,
  shipped_total INTEGER NOT NULL DEFAULT 0,
  has_photo INTEGER NOT NULL DEFAULT 0,
  photo_path TEXT,
  vehicle TEXT,
  supplier TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inward_company ON inward_entries(company_id);

CREATE TABLE IF NOT EXISTS outward_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inward_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  vehicle TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(inward_id) REFERENCES inward_entries(id) ON DELETE CASCADE,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_outward_inward ON outward_shipments(inward_id);
CREATE INDEX IF NOT EXISTS idx_outward_company ON outward_shipments(company_id);

CREATE TABLE IF NOT EXISTS record_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id INTEGER,
  action TEXT NOT NULL,
  data_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_history_table_row ON record_history(table_name, row_id);

CREATE TABLE IF NOT EXISTS lookup_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  key TEXT NOT NULL COLLATE NOCASE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  options_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lookup_company_key ON lookup_fields(company_id, key);

CREATE TABLE IF NOT EXISTS lookup_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_id INTEGER NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(field_id) REFERENCES lookup_fields(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lookup_values_field ON lookup_values(field_id);

CREATE TABLE IF NOT EXISTS admin_recovery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  data_json TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Seed root user and a sample company (only if not present)
INSERT OR IGNORE INTO companies (id, name, slug, contact_info, is_active, created_at)
  VALUES (1, 'Root Company (system)', 'root', 'Beam Veda System', 1, datetime('now'));

INSERT OR IGNORE INTO users (id, company_id, username, password_hash, name, email, role, is_active, created_at)
  VALUES (1, NULL, 'Admin', '$2a$10$invalidseedplaceholder', 'System Admin', 'root@example.com', 'root', 1, datetime('now'));

COMMIT;
