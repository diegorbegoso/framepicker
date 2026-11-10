---
description: Add a forward-only SQLite migration to the Mejores Tomas engine. Use when a task changes the database schema, adds a table or column, or says add a migration.
name: add-migration
---

# Add a migration

## When to use

The schema must change: a new table, a new column, a new index.

## Steps

1. Pick the next number: list `engine/mejores_engine/migrations/` and add one to the highest `NNNN`.
2. Create `NNNN_short_name.sql` with DDL only. Declare `ON DELETE` on every foreign key.
3. If you added a table, add its name to `EXPECTED_TABLES` in `engine/mejores_engine/store.py`.
4. Write a test that builds a database at the previous version with data in it, applies the new migration, and checks both the new structure and the old rows (see `tests/test_cache.py` for the pattern).

## Verify

```bash
pnpm test:engine && pnpm lint:engine && pnpm typecheck:engine   # expect: exit 0
```

## Do not

- Do not edit a migration that has shipped.
- Do not write `BEGIN`, `COMMIT` or touch `schema_migrations`: the runner does it.
