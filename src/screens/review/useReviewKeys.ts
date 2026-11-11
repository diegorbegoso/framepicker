import { useEffect, useRef } from "react";
import type { SelectedPhoto } from "../../lib/engine.ts";

const BUSY_TARGET = "input, select, textarea, [contenteditable]";

type Actions = {
  enabled: boolean;
  photos: SelectedPhoto[];
  current: SelectedPhoto | undefined;
  immersive: boolean;
  compare: boolean;
  toggle: (photo: SelectedPhoto) => void;
  confirm: () => void;
  stepBurst: (delta: number) => void;
  moveFocus: (delta: number) => void;
  setCompare: (on: boolean) => void;
  setImmersive: (on: boolean) => void;
};

/**
 * The review's keyboard, global to the window so the person does not have to click first:
 * arrows move between photos and bursts, Space picks, Enter confirms, C compares, F is full screen.
 * Zoom keys (Z, +, -, 0, Shift+arrows) belong to the viewer.
 */
export function useReviewKeys(actions: Actions) {
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!latest.current.enabled) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(BUSY_TARGET)) return;
      // On a button that is not a thumbnail, Space and Enter belong to the button.
      const onOtherButton = !!target?.closest("button, a") && !target?.closest("[data-thumb]");
      const a = latest.current;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowLeft":
          if (event.shiftKey || a.photos.length === 0) return;
          event.preventDefault();
          a.moveFocus(event.key === "ArrowRight" ? 1 : -1);
          return;
        case "ArrowDown":
        case "PageDown":
        case "]":
          event.preventDefault();
          a.stepBurst(1);
          return;
        case "ArrowUp":
        case "PageUp":
        case "[":
          event.preventDefault();
          a.stepBurst(-1);
          return;
        case " ":
          if (onOtherButton || !a.current) return;
          event.preventDefault();
          a.toggle(a.current);
          return;
        case "Enter":
          if (onOtherButton) return;
          event.preventDefault();
          a.confirm();
          return;
        case "c":
        case "C":
          a.setCompare(!a.compare);
          return;
        case "f":
        case "F":
          a.setImmersive(!a.immersive);
          return;
        case "Escape":
          if (a.immersive) a.setImmersive(false);
          else if (a.compare) a.setCompare(false);
          return;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
