CREATE TABLE organize_batches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  folder_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone_at TEXT
);

CREATE TABLE organize_moves (
  batch_id TEXT NOT NULL REFERENCES organize_batches (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  photo_id TEXT,
  source TEXT NOT NULL,
  dest TEXT NOT NULL,
  PRIMARY KEY (batch_id, position)
);
