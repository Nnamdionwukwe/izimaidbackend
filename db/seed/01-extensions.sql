-- db/seed/01-extensions.sql
-- PostgreSQL extensions required by the app

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";     -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "citext";        -- case-insensitive text (optional)