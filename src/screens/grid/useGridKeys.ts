import { useEffect, useRef } from "react";

type Actions = {
  enabled: boolean;
  /** Photos a row holds, to move up and down. */
  columns: () => number;
  /** Position of the photo on screen, or -1 when there is none. */
  at: number;
  hasPhoto: boolean;
  focusAt: (index: number) => void;
  togglePick: () => void;
  toggleMark: () => void;
  enlarge: () => void;
};

/**
 * The grid's keyboard, global to the window: arrows move, Space picks, M marks, Enter or V enlarges.
 * Keys typed into a field, or aimed at a button that is not a photo, are left alone.
 */
export function useGridKeys(actions: Actions) {
  const latest = useRef(actions);
  latest.current = actions;
  const { enabled } = actions;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, select, textarea, [contenteditable]")) return;
      const onOtherButton = !!target?.closest("button, a") && !target?.closest("[data-cell]");
      const a = latest.current;
      const moves: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -a.columns(),
        ArrowDown: a.columns(),
      };
      if (event.key in moves && !event.shiftKey) {
        event.preventDefault();
        a.focusAt(a.at + (moves[event.key] ?? 0));
      } else if (onOtherButton || !a.hasPhoto) {
        return;
      } else if (event.key === " ") {
        event.preventDefault();
        a.togglePick();
      } else if (event.key === "m" || event.key === "M") {
        a.toggleMark();
      } else if (event.key === "Enter" || event.key === "v" || event.key === "V") {
        event.preventDefault();
        a.enlarge();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
