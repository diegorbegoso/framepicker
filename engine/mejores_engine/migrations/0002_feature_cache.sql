CREATE TABLE feature_cache (
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  features_version TEXT NOT NULL,
  eyes INTEGER NOT NULL CHECK (eyes IN (0, 1)),
  features_json TEXT NOT NULL,
  PRIMARY KEY (path, size_bytes, mtime_ns, features_version, eyes)
);
