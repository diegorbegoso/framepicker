import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
import type { LutInfo, SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";
import { CorrectionsPanel } from "../review/CorrectionsPanel.tsx";
import type { Scope } from "../review/scopes.ts";
import type { Edits } from "../review/useEdits.ts";
import { GridCell } from "./GridCell.tsx";
import styles from "./GridScreen.module.css";
import { between, flatten, type GridFilter, visibleItems } from "./items.ts";
import { MiniViewer } from "./MiniViewer.tsx";
import { ViewerModal } from "./ViewerModal.tsx";

type Props = {
  bursts: SelectedBurst[];
  /** False while another screen or mode is on top: the keyboard is then left alone. */
  active: boolean;
  /** Photos marked to act on together (corrections, export): not the same as chosen. */
  marked: ReadonlySet<string>;
  edits: Edits;
  luts: LutInfo[];
  onMarkedChange: (marked: Set<string>) => void;
  onFocusPhoto: (photoId: string | undefined) => void;
  onSetPick: (burstId: string, photo: SelectedPhoto, value: boolean) => void;
  onOpenInBurst: (burstId: string, photoId: string) => void;
  onExport: (scope: Scope) => void;
};

const GAP = 8;

/** Every photo at once. Pick or drop any of them; the sidebar shows the one you are on. */
export function GridScreen({
  bursts,
  active,
  marked,
  edits,
  luts,
  onMarkedChange,
  onFocusPhoto,
  onSetPick,
  onOpenInBurst,
  onExport,
}: Props) {
  const [filter, setFilter] = useState<GridFilter>("all");
  const [size, setSize] = useState(180);
  const [focusedId, setFocusedId] = useState<string | undefined>();
  const [modal, setModal] = useState(false);
  const anchor = useRef<string | undefined>(undefined);
  const grid = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, HTMLDivElement>());

  const all = useMemo(() => flatten(bursts), [bursts]);
  const items = useMemo(() => visibleItems(all, filter), [all, filter]);
  const counts = useMemo(
    () => ({
      all: all.length,
      picked: all.filter((i) => i.photo.selected).length,
      unpicked: all.filter((i) => !i.photo.selected).length,
      low: all.filter((i) => i.photo.fails.length > 0).length,
    }),
    [all],
  );

  const at = Math.max(
    items.findIndex((i) => i.photo.id === focusedId),
    0,
  );
  const current = items[at];
  const currentId = current?.photo.id;
  useEffect(() => onFocusPhoto(currentId), [currentId, onFocusPhoto]);

  function focusAt(index: number) {
    const next = items[Math.min(Math.max(index, 0), items.length - 1)];
    if (!next) return;
    setFocusedId(next.photo.id);
    anchor.current = next.photo.id;
    const node = cells.current.get(next.photo.id);
    node?.scrollIntoView?.({ block: "nearest" });
    node?.querySelector<HTMLElement>("[data-cell]")?.focus({ preventScroll: true });
  }

  function pick(id: string, range: boolean) {
    const index = items.findIndex((i) => i.photo.id === id);
    const item = items[index];
    if (!item) return;
    const value = !item.photo.selected;
    const from = range ? items.findIndex((i) => i.photo.id === anchor.current) : -1;
    const targets = from >= 0 ? between(items, from, index) : [item];
    for (const target of targets) {
      if (target.photo.selected !== value) onSetPick(target.burstId, target.photo, value);
    }
    anchor.current = id;
    setFocusedId(id);
  }

  /** Ctrl+click marks or unmarks one photo; Shift+click marks everything from the last one. */
  function mark(id: string, how: "toggle" | "range") {
    const index = items.findIndex((i) => i.photo.id === id);
    if (index < 0) return;
    const next = new Set(marked);
    const from = how === "range" ? items.findIndex((i) => i.photo.id === anchor.current) : -1;
    if (from >= 0) {
      for (const item of between(items, from, index)) next.add(item.photo.id);
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onMarkedChange(next);
    anchor.current = id;
    setFocusedId(id);
  }

  const columns = () =>
    Math.max(1, Math.floor(((grid.current?.clientWidth ?? 0) + GAP) / (size + GAP)));

  const latest = useRef({ items, at, current, pick, mark, focusAt, columns });
  latest.current = { items, at, current, pick, mark, focusAt, columns };

  useEffect(() => {
    if (!active || modal) return;
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
      } else if (event.key === " " && !onOtherButton && a.current) {
        event.preventDefault();
        a.pick(a.current.photo.id, false);
      } else if ((event.key === "m" || event.key === "M") && !onOtherButton && a.current) {
        a.mark(a.current.photo.id, "toggle");
      } else if (
        (event.key === "Enter" || event.key === "v" || event.key === "V") &&
        !onOtherButton
      ) {
        if (a.current) {
          event.preventDefault();
          setModal(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, modal]);

  const options: { value: GridFilter; label: string; count: number }[] = [
    { value: "all", label: "Todas", count: counts.all },
    { value: "picked", label: "Elegidas", count: counts.picked },
    { value: "unpicked", label: "No elegidas", count: counts.unpicked },
    { value: "low", label: "Bajo el mínimo", count: counts.low },
  ];

  return (
    <section aria-label="Cuadrícula de todas las fotos" className={styles.root}>
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <SegmentedControl
            label="Mostrar fotos"
            value={filter}
            options={options}
            onChange={setFilter}
          />
          <div className={styles.marks}>
            <span className={styles.markCount}>{marked.size} marcadas</span>
            <Button
              size="sm"
              disabled={items.length === 0}
              onClick={() => onMarkedChange(new Set([...marked, ...items.map((i) => i.photo.id)]))}
            >
              Marcar visibles
            </Button>
            <Button
              size="sm"
              disabled={marked.size === 0}
              onClick={() => onMarkedChange(new Set())}
            >
              Limpiar marcadas
            </Button>
          </div>
          <label className={styles.size}>
            Tamaño
            <input
              type="range"
              aria-label="Tamaño de las miniaturas"
              min={110}
              max={320}
              step={10}
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            />
          </label>
        </div>
        <div
          ref={grid}
          className={styles.grid}
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
        >
          {items.length === 0 ? (
            <p className={styles.empty}>No hay fotos con este filtro.</p>
          ) : null}
          {items.map((item) => (
            <GridCell
              key={item.photo.id}
              item={item}
              focused={item.photo.id === current?.photo.id}
              marked={marked.has(item.photo.id)}
              edited={edits.edited.has(item.photo.id)}
              setRef={(id, node) => {
                if (node) cells.current.set(id, node);
                else cells.current.delete(id);
              }}
              onFocus={(id, anchored) => {
                setFocusedId(id);
                if (anchored) anchor.current = id;
              }}
              onMark={mark}
              onOpen={(id) => {
                setFocusedId(id);
                setModal(true);
              }}
              onPick={pick}
            />
          ))}
        </div>
      </div>
      <aside aria-label="Foto enfocada" className={styles.side}>
        <MiniViewer
          item={current}
          onOpen={() => setModal(true)}
          onPick={() => current && pick(current.photo.id, false)}
          onOpenInBurst={() => current && onOpenInBurst(current.burstId, current.photo.id)}
        />
        <CorrectionsPanel
          photo={current?.photo}
          bursts={bursts}
          marked={marked}
          edits={edits}
          luts={luts}
          onExport={onExport}
        />
      </aside>
      {modal && current ? (
        <ViewerModal
          item={current}
          index={at}
          count={items.length}
          onClose={() => setModal(false)}
          onStep={(delta) => focusAt(at + delta)}
          onPick={() => pick(current.photo.id, false)}
        />
      ) : null}
    </section>
  );
}
