import { useCallback, useEffect, useState } from "react";
import { type LutInfo, listLuts } from "../../lib/engine.ts";

/** The LUTs in the program's library, and a way to read them again after they change. */
export function useLuts() {
  const [luts, setLuts] = useState<LutInfo[]>([]);
  const refresh = useCallback(() => {
    listLuts()
      .then((found) =>
        setLuts(
          [...found].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
        ),
      )
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);
  return { luts, refresh };
}
