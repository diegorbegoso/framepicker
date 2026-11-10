---

description: Forward-only SQLite migrations
paths:

- "engine/mejores_engine/migrations/**"

---

# Migration rules

- File names are `NNNN_snake_case.sql` with a 4-digit, zero-padded, ascending number. The runner rejects any other name.
- A migration that has shipped is never edited. Add the next number instead.
- Write only DDL and data fixes. The runner wraps each file in `BEGIN; ... COMMIT;` and records the version itself, so do not add transaction statements or touch `schema_migrations`.
- Every foreign key declares its `ON DELETE` behaviour. Deleting a session cascades to everything under it.
- A new table must also be added to `EXPECTED_TABLES` in `store.py` in the same change.
- Test every new migration against a database that already holds data from the previous version.
