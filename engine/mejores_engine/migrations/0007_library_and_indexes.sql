-- Deleting a session cascades to its photos; without these, every deleted photo scanned the
-- whole of `selections` and `burst_members` (their primary keys start with burst_id).
CREATE INDEX idx_selections_photo ON selections (photo_id);
CREATE INDEX idx_members_photo ON burst_members (photo_id);
CREATE INDEX idx_organize_session ON organize_batches (session_id);

-- LUTs get a group (the folder they were imported from), a favourite mark and their file name.
ALTER TABLE luts ADD COLUMN group_name TEXT;
ALTER TABLE luts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE luts ADD COLUMN source_name TEXT;
