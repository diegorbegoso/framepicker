import { useCallback, useMemo, useState } from "react";
import { cx } from "../lib/cx.ts";
import type { SelectedBurst, SelectedPhoto, SelectResult } from "../lib/engine.ts";
import * as engine from "../lib/engine.ts";
import { firstPickedIndex } from "../lib/focus.ts";
import type { Theme } from "../lib/theme.ts";
import type { ExportRequest } from "./ActionsBar.tsx";
import { GridScreen } from "./grid/GridScreen.tsx";
import { type Mode, ReviewBar } from "./ReviewBar.tsx";
import styles from "./ReviewScreen.module.css";
import { type BurstFilter, BurstList, isReviewed } from "./review/BurstList.tsx";
import { Filmstrip } from "./review/Filmstrip.tsx";
import { PhotoViewer } from "./review/PhotoViewer.tsx";
import { SidePanel } from "./review/SidePanel.tsx";
import { buildScopes, type Scope } from "./review/scopes.ts";
import { useEdits } from "./review/useEdits.ts";
import { useLuts } from "./review/useLuts.ts";
import { usePicks } from "./review/usePicks.ts";
import { useReviewEffects } from "./review/useReviewEffects.ts";
import { useReviewKeys } from "./review/useReviewKeys.ts";

type Props = {
  sessionId: string;
  initial: SelectResult;
  /** False while another screen is on top: the keyboard and full screen are then left alone. */
  active?: boolean;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  immersive: boolean;
  onImmersiveChange: (on: boolean) => void;
  onReset: () => void;
};

export function ReviewScreen({
  sessionId,
  initial,
  active = true,
  theme,
  onThemeChange,
  immersive,
  onImmersiveChange,
  onReset,
}: Props) {
  const [bursts, setBursts] = useState<SelectedBurst[]>(initial.bursts);
  const [activeId, setActiveId] = useState<string | undefined>(initial.bursts[0]?.id);
  const [focused, setFocused] = useState(() => firstPickedIndex(initial.bursts[0]?.photos ?? []));
  const [filter, setFilter] = useState<BurstFilter>("all");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("bursts");
  const [compare, setCompare] = useState(false);
  const [referenceId, setReferenceId] = useState<string | undefined>();
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1180);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [gridFocus, setGridFocus] = useState<string | undefined>();
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null);

  const edits = useEdits(sessionId, setError);
  const { luts, refresh: refreshLuts } = useLuts();
  const { setPick } = usePicks(setBursts, setError, setAnnouncement);

  const burst = bursts.find((b) => b.id === activeId) ?? bursts[0];
  const photos = burst?.photos ?? [];
  const current: SelectedPhoto | undefined = photos[focused];
  const reference =
    photos.find((p) => p.id === referenceId) ?? photos.find((p) => p.selected) ?? photos[0];
  const pickedCount = bursts.reduce((n, b) => n + b.photos.filter((p) => p.selected).length, 0);
  const lookingAt = mode === "grid" ? gridFocus : current?.id;
  const scopes = useMemo(() => buildScopes(bursts, lookingAt, marked), [bursts, lookingAt, marked]);

  const visible = filter === "todo" ? bursts.filter((b) => !isReviewed(b)) : bursts;

  const selectBurst = useCallback(
    (id: string) => {
      setActiveId(id);
      setFocused(firstPickedIndex(bursts.find((b) => b.id === id)?.photos ?? []));
      setReferenceId(undefined);
    },
    [bursts],
  );

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
    enabled: active && mode === "bursts" && !busy,
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

  const requestExport = (scope: Scope) =>
    setExportRequest((last) => ({ id: (last?.id ?? 0) + 1, scope }));

  return (
    <section
      aria-label="Revisión de ráfagas"
      className={cx(styles.shell, immersive && styles.immersive)}
    >
      <h2 className={styles.srOnly}>Revisa tus ráfagas</h2>
      {immersive ? null : (
        <ReviewBar
          mode={mode}
          onMode={setMode}
          sessionId={sessionId}
          pickedCount={pickedCount}
          scopes={scopes}
          exportRequest={exportRequest}
          theme={theme}
          onThemeChange={onThemeChange}
          onLutsChanged={refreshLuts}
          onBusy={setBusy}
        />
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
            bursts={bursts}
            marked={marked}
            edits={edits}
            luts={luts}
            onExport={requestExport}
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
          active={active && !busy}
          marked={marked}
          edits={edits}
          luts={luts}
          onMarkedChange={setMarked}
          onFocusPhoto={setGridFocus}
          onSetPick={(burstId, photo, value) => void setPick(burstId, photo, value)}
          onOpenInBurst={openInBurst}
          onExport={requestExport}
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
