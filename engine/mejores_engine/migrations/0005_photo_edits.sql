CREATE TABLE photo_edits (
  photo_id TEXT PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  params_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
