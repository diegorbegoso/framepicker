---

name: add-engine-method
description: Add a new JSON-RPC method to the Framepicker analysis engine and expose it to the interface. Use when a task says add an engine method, a new RPC call, or a new command the UI can request.
---

# Add an engine method

## When to use

A feature needs the UI to ask the engine for something new (a query, a job, a setting).

## Steps

1. In `engine/mejores_engine/app.py`, register the handler inside `build_dispatcher` with `@dispatcher.register("name")`. Validate every param and raise `RpcError` with a code from `rpc.py` on bad input.
2. If the method runs longer than about a second, make it a background job with `Jobs` and report through `progress` and `job_done` notifications instead of blocking.
3. Add the method name to `FORWARDABLE` in `src-tauri/src/engine.rs`. Never add `grant_roots`.
4. Add a typed wrapper with a zod schema in `src/lib/engine.ts`.
5. Write the engine test first (`engine/tests/`), then the UI test with `engine.ts` mocked.

## Verify

```bash
pnpm test:engine && pnpm lint:engine && pnpm typecheck:engine   # expect: exit 0
pnpm test:rust && pnpm exec vitest run                          # expect: exit 0
```

## Do not

- Do not print to stdout from a handler.
- Do not forward a method the UI does not need.
