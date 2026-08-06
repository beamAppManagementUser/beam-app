-- migrations/0002_add_pipe_size.sql
-- Add nullable pipe_size column to inward_entries if it doesn't already exist
ALTER TABLE inward_entries ADD COLUMN IF NOT EXISTS pipe_size TEXT NULL;
