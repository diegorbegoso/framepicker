ALTER TABLE sessions ADD COLUMN source_key TEXT;
ALTER TABLE sessions ADD COLUMN updated_at TEXT;
ALTER TABLE sessions ADD COLUMN last_burst_id TEXT;

CREATE INDEX idx_sessions_source_key ON sessions (source_key);
