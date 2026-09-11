-- db/seed/02-enums.sql
-- Enumerated types used across the schema

-- User roles
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('customer', 'maid', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auth provider
DO $$ BEGIN
  CREATE TYPE auth_provider AS ENUM ('email', 'google');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;