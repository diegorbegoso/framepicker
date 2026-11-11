import { useCallback, useEffect, useState } from "react";
import { cx } from "../lib/cx.ts";
import type { SelectedBurst, SelectedPhoto, SelectResult } from "../lib/engine.ts";
import * as engine from "../lib/engine.ts";
import { firstPickedIndex } from "../lib/focus.ts";
import { previews } from "../lib/previews.ts";
import { setFullscreen } from "../lib/window.ts";
import { ExportPanel } from "./ExportPanel.tsx";
import styles from "./ReviewScreen.module.css";
import { type BurstFilter, BurstList, isReviewed } from "./review/BurstList.tsx";
import { Filmstrip } from "./review/Filmstrip.tsx";
import { PhotoViewer } from "./review/PhotoViewer.tsx";
import { ScoresPanel } from "./review/ScoresPanel.tsx";
import { SettingsPanel } from "./review/SettingsPanel.tsx";
import { ShortcutsHelp } from "./review/ShortcutsHelp.tsx";
import { useReviewKeys } from "./review/useReviewKeys.ts";

type Props = {
  sessionId: string;
  initial: SelectResult;
  /** False while another screen is on top: the keyboard and full screen are then left alone. */
  active?: boolean;
  immersive: boolean;
  onImmersiveChange: (on: boolean) => void;
  onReset: () => void;
};

export function ReviewScreen({
  sessionId,
  initial,
  active = true,
  immersive,
  onImmersiveChange,
  onReset,
}: Props) {
  const [bursts, setBursts] = useState<SelectedBurst[]>(initial.bursts);
  const [activeId, setActiveId] = useState<string | undefined>(initial.bursts[0]?.id);
  const [focused, setFocused] = useState(() => firstPickedIndex(initial.bursts[0]?.photos ?? []));
  const [filter, setFilter] = useState<BurstFilter>("all");
  const [compare, setCompare] = useState(false);
  const [referenceId, setReferenceId] = useState<string | undefined>();
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1180);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const burst = bursts.find((b) => b.id === activeId) ?? bursts[0];
  const photos = burst?.photos ?? [];
  const current: SelectedPhoto | undefined = photos[focused];
  const reference =
    photos.find((p) => p.id === referenceId) ?? photos.find((p) => p.selected) ?? photos[0];
  const selectedCount = bursts.reduce((n, b) => n + b.photos.filter((p) => p.selected).length, 0);

  const visible = filter === "todo" ? bursts.filter((b) => !isReviewed(b)) : bursts;

  const selectBurst = useCallback(
    (id: string) => {
      setActiveId(id);
      setFocused(firstPickedIndex(bursts.find((b) => b.id === id)?.photos ?? []));
      setReferenceId(undefined);
    },
    [bursts],
  );

  function replacePhoto(burstId: string, photoId: string, patch: Partial<SelectedPhoto>) {
    setBursts((all) =>
      all.map((b) =>
        b.id !== burstId
          ? b
          : { ...b, photos: b.photos.map((p) => (p.id === photoId ? { ...p, ...patch } : p)) },
      ),
    );
  }

  async function toggle(photo: SelectedPhoto) {
    if (!burst) return;
    const next = !photo.selected;
    const name = engine.fileName(photo.path);
    replacePhoto(burst.id, photo.id, { selected: next, source: "user" });
    setAnnouncement(`${name}: ${next ? "elegida" : "no elegida"}`);
    try {
      await engine.setPick(burst.id, photo.id, next);
      setError(null);
    } catch {
      replacePhoto(burst.id, photo.id, { selected: photo.selected, source: photo.source });
      setError("No se pudo guardar la elección.");
    }
  }

  async function confirm() {
    if (!burst || isReviewed(burst)) return;
    try {
      await engine.confirmBurst(burst.id);
    } catch {
      setError("No se pudo confirmar la ráfaga.");
      return;
    }
    setError(null);
    setBursts((all) =>
      all.map((b) =>
        b.id === burst.id
          ? { ...b, photos: b.photos.map((p) => ({ ...p, source: "user" as const })) }
          : b,
      ),
    );
    setAnnouncement(`Ráfaga ${burst.position + 1} confirmada`);
    const after = bursts.slice(bursts.findIndex((b) => b.id === burst.id) + 1);
    const next =
      after.find((b) => !isReviewed(b)) ?? bursts.find((b) => b.id !== burst.id && !isReviewed(b));
    if (next) selectBurst(next.id);
  }

  function stepBurst(delta: number) {
    const list = visible.length > 0 ? visible : bursts;
    const at = list.findIndex((b) => b.id === burst?.id);
    const next = list[(Math.max(at, 0) + delta + list.length) % list.length];
    if (next) selectBurst(next.id);
  }

  useReviewKeys({
    enabled: active,
    photos,
    current,
    immersive,
    compare,
    toggle: (photo) => void toggle(photo),
    confirm: () => void confirm(),
    stepBurst,
    moveFocus: (delta) => setFocused((i) => (i + delta + photos.length) % photos.length),
    setCompare,
    setImmersive: onImmersiveChange,
  });

  // Full screen follows the immersive mode, and is always given back on leaving the review.
  useEffect(() => {
    void setFullscreen(immersive && active);
  }, [immersive, active]);
  useEffect(
    () => () => {
      void setFullscreen(false);
      previews.clear();
    },
    [],
  );

  // Warm the photos the person is most likely to look at next.
  const previousId = photos[focused - 1]?.id;
  const nextId = photos[focused + 1]?.id;
  useEffect(() => {
    for (const id of [previousId, nextId]) {
      if (id) void previews.request(id, "view", 1).catch(() => undefined);
    }
  }, [previousId, nextId]);

  return (
    <section
      aria-label="Revisión de ráfagas"
      className={cx(styles.root, !panelOpen && styles.noPanel, immersive && styles.immersive)}
    >
      <h2 className={styles.srOnly}>Revisa tus ráfagas</h2>
      {immersive ? null : (
        <BurstList
          bursts={bursts}
          activeId={burst?.id}
          filter={filter}
          onFilter={setFilter}
          onSelect={selectBurst}
          onReset={onReset}
        />
      )}
      <div className={styles.center}>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <PhotoViewer
          photo={current}
          index={focused}
          count={photos.length}
          reference={reference}
          compare={compare}
          immersive={immersive}
          panelOpen={panelOpen && !immersive}
          reviewed={burst ? isReviewed(burst) : false}
          active={active}
          onToggle={(photo) => void toggle(photo)}
          onConfirm={() => void confirm()}
          onCompare={() => setCompare((on) => !on)}
          onPin={() => setReferenceId(current?.id)}
          onImmersive={() => onImmersiveChange(!immersive)}
          onPanel={() => setPanelOpen((open) => !open)}
        />
        <Filmstrip photos={photos} focused={focused} onFocus={setFocused} />
      </div>
      {panelOpen && !immersive ? (
        <aside aria-label="Panel de la ráfaga" className={styles.side}>
          <ScoresPanel photo={current} />
          <SettingsPanel
            sessionId={sessionId}
            onApplied={(next) => {
              setBursts(next);
              setFocused(firstPickedIndex(next.find((b) => b.id === burst?.id)?.photos ?? []));
            }}
            onError={setError}
          />
          <ExportPanel sessionId={sessionId} selectedCount={selectedCount} />
          <ShortcutsHelp />
        </aside>
      ) : null}
      <p role="status" className={styles.srOnly}>
        {announcement}
      </p>
    </section>
  );
}
