import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../../components/IconButton.tsx";
import { NumberField } from "../../../components/NumberField.tsx";
import type { Adjustments, LutInfo } from "../../../lib/engine.ts";
import { Section } from "../Section.tsx";
import styles from "./LutGallery.module.css";
import { LutTile } from "./LutTile.tsx";

const COLUMNS = 3;

type Props = {
  photoId: string;
  current: Adjustments;
  luts: LutInfo[];
  onChange: (patch: Partial<Adjustments>) => void;
  /** A LUT is being looked at (hover or focus): show it on the photo. `undefined`: stop. */
  onHover: (lutId: string | null | undefined) => void;
  onFavorite: (lut: LutInfo) => void;
  onClose: () => void;
};

const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A side drawer with every LUT shown on this photo, so the choice is made by eye. */
export function LutGallery({
  photoId,
  current,
  luts,
  onChange,
  onHover,
  onFavorite,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const root = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const hovered = useRef(0);
  const stop = useRef(onHover);
  stop.current = onHover;

  useEffect(() => {
    const before = document.activeElement;
    search.current?.focus();
    return () => {
      stop.current(undefined);
      if (before instanceof HTMLElement) before.focus({ preventScroll: true });
    };
  }, []);

  const { favorites, loose, groups } = useMemo(() => {
    const wanted = plain(query.trim());
    const shown = luts.filter(
      (lut) =>
        wanted === "" ||
        plain(lut.name).includes(wanted) ||
        plain(lut.group ?? "").includes(wanted),
    );
    const byName = (a: LutInfo, b: LutInfo) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    const map = new Map<string, LutInfo[]>();
    for (const lut of shown.filter((item) => item.group !== null)) {
      map.set(lut.group as string, [...(map.get(lut.group as string) ?? []), lut]);
    }
    return {
      favorites: shown.filter((lut) => lut.favorite).sort(byName),
      loose: shown.filter((lut) => lut.group === null).sort(byName),
      groups: [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "es", { sensitivity: "base" }))
        .map(([name, items]) => ({ name, items: items.sort(byName) })),
    };
  }, [luts, query]);

  /** A short pause before dropping the preview, so moving across tiles does not flicker. */
  function hover(lutId: string | null) {
    return (on: boolean) => {
      if (on) {
        hovered.current += 1;
        onHover(lutId);
      } else {
        const mine = hovered.current;
        window.setTimeout(() => {
          if (hovered.current === mine) onHover(undefined);
        }, 60);
      }
    };
  }

  function keys(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const tiles = [...(root.current?.querySelectorAll<HTMLElement>("[data-lut-tile]") ?? [])];
    const index = tiles.indexOf(document.activeElement as HTMLElement);
    if (event.key === "/" && document.activeElement !== search.current) {
      event.preventDefault();
      search.current?.focus();
      return;
    }
    if (index < 0) return;
    const jumps: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const jump = jumps[event.key];
    if (jump !== undefined) {
      event.preventDefault();
      tiles[Math.max(0, Math.min(tiles.length - 1, index + jump))]?.focus();
    } else if (event.key.toLowerCase() === "f") {
      const id = tiles[index]?.dataset.lut;
      const lut = luts.find((item) => item.id === id);
      if (lut) onFavorite(lut);
    }
  }

  const tile = (lut: LutInfo | null) => (
    <LutTile
      key={lut?.id ?? "none"}
      photoId={photoId}
      adjustments={current}
      lut={lut}
      active={(lut?.id ?? null) === current.lut_id}
      onPick={() => onChange({ lut_id: lut?.id ?? null })}
      onHover={hover(lut?.id ?? null)}
      onFavorite={lut ? () => onFavorite(lut) : undefined}
    />
  );

  const nothing = favorites.length + loose.length + groups.length === 0;

  return (
    <aside
      ref={root}
      role="dialog"
      aria-label="Elegir LUT"
      className={styles.drawer}
      onKeyDown={keys}
    >
      <header className={styles.header}>
        <h3 className={styles.title}>Elegir LUT</h3>
        <IconButton icon="x" label="Cerrar" shortcut="Esc" onClick={onClose} />
      </header>
      <input
        ref={search}
        type="search"
        className={styles.search}
        placeholder="Buscar LUT… ( / )"
        aria-label="Buscar LUT"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.scroll}>
        <div className={styles.grid}>{tile(null)}</div>
        {favorites.length > 0 ? (
          <Section title="Favoritos" defaultOpen>
            <div className={styles.grid}>{favorites.map((lut) => tile(lut))}</div>
          </Section>
        ) : null}
        {groups.map((group) => (
          <Section key={group.name} title={`${group.name} (${group.items.length})`} defaultOpen>
            <div className={styles.grid}>{group.items.map((lut) => tile(lut))}</div>
          </Section>
        ))}
        {loose.length > 0 ? (
          <Section title={groups.length > 0 ? `Sueltos (${loose.length})` : "LUT"} defaultOpen>
            <div className={styles.grid}>{loose.map((lut) => tile(lut))}</div>
          </Section>
        ) : null}
        {nothing ? (
          <p role="status" className={styles.empty}>
            {luts.length === 0
              ? "Aún no has cargado ningún LUT. Usa el botón LUT… de la barra superior."
              : "Ningún LUT coincide con la búsqueda."}
          </p>
        ) : null}
      </div>
      {current.lut_id ? (
        <footer className={styles.footer}>
          <span className={styles.row}>
            Intensidad
            <NumberField
              label="Intensidad del LUT (valor)"
              value={current.lut_strength * 100}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(next) => onChange({ lut_strength: next / 100 })}
            />
          </span>
          <input
            type="range"
            aria-label="Intensidad del LUT"
            min={0}
            max={1}
            step={0.01}
            value={current.lut_strength}
            onChange={(event) => onChange({ lut_strength: Number(event.target.value) })}
          />
        </footer>
      ) : null}
    </aside>
  );
}
