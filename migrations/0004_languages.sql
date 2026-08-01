-- Add language support to companies and users tables
ALTER TABLE companies ADD COLUMN admin_default_lang TEXT NOT NULL DEFAULT 'en';
ALTER TABLE companies ADD COLUMN employee_default_lang TEXT NOT NULL DEFAULT 'hi';
ALTER TABLE users ADD COLUMN language TEXT;
