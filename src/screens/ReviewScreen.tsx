import { useCallback, useState } from "react";
import { SegmentedControl } from "../components/SegmentedControl.tsx";
import { cx } from "../lib/cx.ts";
import type { SelectedBurst, SelectedPhoto, SelectResult } from "../lib/engine.ts";
import * as engine from "../lib/engine.ts";
import { firstPickedIndex } from "../lib/focus.ts";
import { GridScreen } from "./grid/GridScreen.tsx";
import styles from "./ReviewScreen.module.css";
import { type BurstFilter, BurstList, isReviewed } from "./review/BurstList.tsx";
import { Filmstrip } from "./review/Filmstrip.tsx";
import { PhotoViewer } from "./review/PhotoViewer.tsx";
import { SidePanel } from "./review/SidePanel.tsx";
import { useReviewEffects } from "./review/useReviewEffects.ts";
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
  const [mode, setMode] = useState<"bursts" | "grid">("bursts");
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

  async function setPick(burstId: string, photo: SelectedPhoto, next: boolean) {
    const name = engine.fileName(photo.path);
    replacePhoto(burstId, photo.id, { selected: next, source: "user" });
    setAnnouncement(`${name}: ${next ? "elegida" : "no elegida"}`);
    try {
      await engine.setPick(burstId, photo.id, next);
      setError(null);
    } catch {
      replacePhoto(burstId, photo.id, { selected: photo.selected, source: photo.source });
      setError("No se pudo guardar la elección.");
    }
  }

  async function toggle(photo: SelectedPhoto) {
    if (burst) await setPick(burst.id, photo, !photo.selected);
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
    enabled: active && mode === "bursts",
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

  useReviewEffects({
    immersive,
    active,
    previousId: photos[focused - 1]?.id,
    nextId: photos[focused + 1]?.id,
  });

  function openInBurst(burstId: string, photoId: string) {
    const target = bursts.find((b) => b.id === burstId);
    setActiveId(burstId);
    setFocused(Math.max(target?.photos.findIndex((p) => p.id === photoId) ?? 0, 0));
    setReferenceId(undefined);
    setMode("bursts");
  }

  return (
    <section
      aria-label="Revisión de ráfagas"
      className={cx(styles.shell, immersive && styles.immersive)}
    >
      <h2 className={styles.srOnly}>Revisa tus ráfagas</h2>
      {immersive ? null : (
        <div className={styles.tabs}>
          <SegmentedControl
            label="Vista"
            value={mode}
            options={[
              { value: "bursts", label: "Ráfagas", icon: "images" },
              { value: "grid", label: "Cuadrícula", icon: "grid" },
            ]}
            onChange={setMode}
          />
          <span className={styles.total}>{selectedCount} elegidas</span>
        </div>
      )}
      <div
        className={cx(styles.root, !panelOpen && styles.noPanel, immersive && styles.immersive)}
        hidden={mode !== "bursts"}
      >
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
            active={active && mode === "bursts"}
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
          <SidePanel
            sessionId={sessionId}
            photo={current}
            selectedCount={selectedCount}
            onApplied={(next) => {
              setBursts(next);
              setFocused(firstPickedIndex(next.find((b) => b.id === burst?.id)?.photos ?? []));
            }}
            onError={setError}
          />
        ) : null}
      </div>
      {mode === "grid" ? (
        <GridScreen
          bursts={bursts}
          active={active}
          onSetPick={(burstId, photo, value) => void setPick(burstId, photo, value)}
          onOpenInBurst={openInBurst}
        />
      ) : null}
      {error && mode === "grid" ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <p role="status" className={styles.srOnly}>
        {announcement}
      </p>
    </section>
  );
}
