---

description: React interface conventions
paths:

- "src/**"

---

# UI rules

- Colours, spacing, radii and fonts come from `src/styles/tokens.css` through `var(--token)`. No hex, `rgb()`, `rgba()` or `hsl()` outside that file; `src/lib/theme.test.ts` enforces it.
- Light is the default theme. Never follow `prefers-color-scheme`; the theme is a user setting.
- All user-facing text is Spanish. Keep the exact strings the acceptance criteria quote.
- Screens call the engine only through `src/lib/engine.ts`; every reply is parsed with zod there.
- Every control has an accessible name; status changes use `role="status"`, errors use `role="alert"`. Anything operable by mouse is operable by keyboard.
- Respect `prefers-reduced-motion`: animate through the `--dur*` tokens, which collapse to 0.
- Components hold no business logic. Scoring, grouping and selection live in the engine.
