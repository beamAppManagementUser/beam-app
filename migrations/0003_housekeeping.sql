-- App settings table for housekeeping/purge configuration
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by)
VALUES ('purge_all_days', '90', '2026-07-31T00:00:00Z', 'system');

INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by)
VALUES ('purge_completed_days', '30', '2026-07-31T00:00:00Z', 'system');

INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by)
VALUES ('purge_all_enabled', '1', '2026-07-31T00:00:00Z', 'system');

INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by)
VALUES ('purge_completed_enabled', '1', '2026-07-31T00:00:00Z', 'system');
