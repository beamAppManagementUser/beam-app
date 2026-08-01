-- Photos table — store photos in D1 instead of R2 (base64 encoded)
-- Hard limit: 5,000 photos max (enforced in code)
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_created ON photos(created_at);

-- Backups table — store backups in D1 instead of R2 (JSON text)
-- Hard limit: 10 system backups, 10 per company (enforced in code)
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('system','company')),
  company_id INTEGER,
  filename TEXT NOT NULL,
  data TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_type_company ON backups(type, company_id);

-- App setting: photo uploads enabled/disabled (root admin toggle)
INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by)
VALUES ('photo_uploads_enabled', '1', '2026-07-31T00:00:00Z', 'system');

-- App setting: max photo size in KB (hard limit)
INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by)
VALUES ('max_photo_size_kb', '200', '2026-07-31T00:00:00Z', 'system');
