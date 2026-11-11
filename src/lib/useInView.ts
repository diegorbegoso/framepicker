import { useEffect, useRef, useState } from "react";

/**
 * Becomes `seen` the first time the element comes near the viewport, and stays that way.
 * Used to load a thumbnail only when its row scrolls into view. Without IntersectionObserver
 * (tests) everything counts as seen.
 */
export function useInView<T extends Element>(margin = "240px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const node = ref.current;
    if (seen || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen, margin]);
  return { ref, seen };
}
