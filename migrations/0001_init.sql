-- Beam App Management — D1 Schema
-- Migrated from better-sqlite3 to Cloudflare D1

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  logo_path TEXT,
  contact TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  pk INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL COLLATE NOCASE,
  company_id INTEGER,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','employee')),
  active INTEGER NOT NULL DEFAULT 1,
  is_root INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  UNIQUE(company_id, id),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_recovery (
  user_pk INTEGER PRIMARY KEY,
  question1 TEXT NOT NULL,
  answer1_hash TEXT NOT NULL,
  question2 TEXT NOT NULL,
  answer2_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  FOREIGN KEY(user_pk) REFERENCES users(pk) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lookup_fields (
  company_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  use_lookup INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, field_key),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lookup_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(company_id, field_key, value),
  FOREIGN KEY(company_id, field_key) REFERENCES lookup_fields(company_id, field_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inward_entries (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  customer_number TEXT NOT NULL,
  party_name TEXT NOT NULL,
  pipe_number TEXT,
  number_of_pipes INTEGER NOT NULL,
  pipe_size TEXT NOT NULL,
  inward_date TEXT NOT NULL,
  inward_vehicle_reg TEXT NOT NULL,
  notes TEXT,
  has_photo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  device_info TEXT,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inward_company_date ON inward_entries(company_id, inward_date);

CREATE TABLE IF NOT EXISTS outward_shipments (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  inward_id TEXT NOT NULL REFERENCES inward_entries(id),
  pipe_number TEXT,
  number_of_pipes INTEGER NOT NULL,
  outward_date TEXT NOT NULL,
  outward_vehicle_reg TEXT NOT NULL,
  notes TEXT,
  has_photo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  device_info TEXT,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_outward_inward ON outward_shipments(inward_id);
CREATE INDEX IF NOT EXISTS idx_outward_company_date ON outward_shipments(company_id, outward_date);

CREATE TABLE IF NOT EXISTS record_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  inward_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('inward','outward')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','update','delete')),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  device_info TEXT,
  snapshot TEXT NOT NULL,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_history_inward ON record_history(inward_id);
CREATE INDEX IF NOT EXISTS idx_history_company_time ON record_history(company_id, changed_at);
