-- Migration: Add issue_type column to issues table
-- Applied: 2026-07-19 via direct SQL (executeSql)
ALTER TABLE issues ADD COLUMN IF NOT EXISTS issue_type text;
