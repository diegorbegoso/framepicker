import type { SelectedBurst } from "../../lib/engine.ts";

/** Which photos an action reaches: the one on screen, its burst, the chosen ones, the marked ones, all. */
export type Scope = "current" | "burst" | "picked" | "marked" | "all";

export type ScopeIds = Record<Scope, string[]>;

export const SCOPE_LABELS: Record<Scope, string> = {
  current: "Solo esta foto",
  burst: "Esta ráfaga",
  picked: "Las elegidas",
  marked: "Las marcadas",
  all: "Todas las fotos",
};

export const SCOPE_ORDER: Scope[] = ["current", "burst", "picked", "marked", "all"];

/** The photo ids behind each scope, for the photo being looked at. Pure: nothing is loaded here. */
export function buildScopes(
  bursts: SelectedBurst[],
  currentId: string | undefined,
  marked: ReadonlySet<string>,
): ScopeIds {
  const every = bursts.flatMap((burst) => burst.photos);
  const home = bursts.find((burst) => burst.photos.some((photo) => photo.id === currentId));
  return {
    current: currentId ? [currentId] : [],
    burst: home ? home.photos.map((photo) => photo.id) : [],
    picked: every.filter((photo) => photo.selected).map((photo) => photo.id),
    marked: every.filter((photo) => marked.has(photo.id)).map((photo) => photo.id),
    all: every.map((photo) => photo.id),
  };
}

export function scopeText(scope: Scope, ids: ScopeIds): string {
  const count = ids[scope].length;
  return scope === "current" ? SCOPE_LABELS[scope] : `${SCOPE_LABELS[scope]} (${count})`;
}
