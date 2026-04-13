-- Migration 001: initial schema
-- Run once via psql as part of the Pulumi userdata startup sequence.

CREATE TABLE IF NOT EXISTS todos (
    id          SERIAL PRIMARY KEY,
    title       TEXT        NOT NULL CHECK (char_length(title) <= 500),
    completed   BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Automatically keep updated_at current on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS todos_set_updated_at ON todos;
CREATE TRIGGER todos_set_updated_at
    BEFORE UPDATE ON todos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
