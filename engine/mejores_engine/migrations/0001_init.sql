CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('jpg', 'png', 'raw')),
  size_bytes INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  exif_time TEXT,
  dhash TEXT,
  UNIQUE (session_id, path)
);

CREATE INDEX idx_photos_session ON photos (session_id);

CREATE TABLE scores (
  photo_id TEXT PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  sharpness REAL NOT NULL,
  exposure REAL NOT NULL,
  mean_luma REAL NOT NULL,
  clip_hi REAL NOT NULL,
  clip_lo REAL NOT NULL,
  eyes_open REAL,
  engine_version TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE bursts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  UNIQUE (session_id, position)
);

CREATE TABLE burst_members (
  burst_id TEXT NOT NULL REFERENCES bursts (id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (burst_id, photo_id),
  UNIQUE (burst_id, position)
);

CREATE TABLE selections (
  burst_id TEXT NOT NULL REFERENCES bursts (id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('auto', 'user')),
  selected INTEGER NOT NULL CHECK (selected IN (0, 1)),
  PRIMARY KEY (burst_id, photo_id)
);
