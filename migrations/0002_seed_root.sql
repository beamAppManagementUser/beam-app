-- Seed root admin — run AFTER 0001_init.sql
-- The password is set via `npm run reset-password` after deployment.

INSERT INTO users (id, company_id, name, password_hash, role, active, is_root, created_at)
VALUES ('Admin', NULL, 'Root Administrator', 'RESET_REQUIRED_USE_NPM_RUN_RESET_PASSWORD', 'admin', 1, 1, datetime('now'))
ON CONFLICT DO NOTHING;
