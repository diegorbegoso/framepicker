import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Panel } from "../../components/Panel.tsx";
import type { Adjustments, LutInfo, SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";
import { isNeutral } from "../../lib/engine.ts";
import { livePreview } from "../../lib/livePreview.ts";
import { previews } from "../../lib/previews.ts";
import styles from "./CorrectionsPanel.module.css";
import { buildScopes, SCOPE_ORDER, type Scope, scopeText } from "./scopes.ts";
import type { Edits } from "./useEdits.ts";

type Slider = { key: Exclude<keyof Adjustments, "lut_id" | "lut_strength">; label: string };

const SLIDERS: Slider[] = [
  { key: "exposure", label: "Exposición" },
  { key: "contrast", label: "Contraste" },
  { key: "highlights", label: "Luces" },
  { key: "shadows", label: "Sombras" },
  { key: "temperature", label: "Temperatura" },
  { key: "tint", label: "Tinte" },
  { key: "saturation", label: "Saturación" },
];

const SAVE_DELAY_MS = 250;

type Props = {
  photo: SelectedPhoto | undefined;
  bursts: SelectedBurst[];
  marked: ReadonlySet<string>;
  edits: Edits;
  luts: LutInfo[];
  onExport: (scope: Scope) => void;
};

/** Number shown next to a slider: stops for exposure, a -100..100 scale for the rest. */
function shown(key: Slider["key"], value: number): string {
  const text = key === "exposure" ? `${value.toFixed(1)} EV` : String(Math.round(value * 100));
  return value > 0 ? `+${text}` : text;
}

/**
 * Basic corrections for the photo on screen, saved as you drag. The same corrections can be copied
 * to a group of photos, and any group can be exported from here.
 */
export function CorrectionsPanel({ photo, bursts, marked, edits, luts, onExport }: Props) {
  const photoId = photo?.id;
  const stored = edits.of(photoId);
  const [draft, setDraft] = useState<{ id: string; value: Adjustments } | null>(null);
  const [scope, setScope] = useState<Scope>("burst");
  const pending = useRef<{ id: string; value: Adjustments; timer: number } | null>(null);
  const save = useRef(edits.apply);
  save.current = edits.apply;

  const current = draft && draft.id === photoId ? draft.value : stored;
  const scopes = useMemo(() => buildScopes(bursts, photoId, marked), [bursts, photoId, marked]);

  // Only refs inside, so it never changes between renders.
  const flush = useCallback(() => {
    const waiting = pending.current;
    if (!waiting) return;
    window.clearTimeout(waiting.timer);
    pending.current = null;
    // Once saved (or put back, if saving failed) the stored value is the truth again, and the
    // live frame goes away as soon as the saved view has loaded behind it, so nothing flickers.
    void save
      .current([waiting.id], waiting.value)
      .then(() => previews.request(waiting.id, "view", 0).catch(() => undefined))
      .then(() => {
        setDraft((now) => (now?.value === waiting.value ? null : now));
        if (pending.current?.id !== waiting.id) livePreview.clear(waiting.id);
      });
  }, []);

  // A pending change is saved before another photo's change replaces it, and when leaving.
  useEffect(() => flush, [flush]);

  function change(patch: Partial<Adjustments>) {
    if (!photoId) return;
    const value = { ...current, ...patch };
    setDraft({ id: photoId, value });
    livePreview.update(photoId, value); // the viewer follows the slider while it moves
    if (pending.current && pending.current.id !== photoId) flush();
    if (pending.current) window.clearTimeout(pending.current.timer);
    const timer = window.setTimeout(flush, SAVE_DELAY_MS);
    pending.current = { id: photoId, value, timer };
  }

  async function copyToGroup() {
    flush();
    await edits.apply(scopes[scope], current);
    setDraft(null);
    for (const id of scopes[scope]) livePreview.clear(id);
  }

  async function restore(ids: string[]) {
    if (pending.current) {
      window.clearTimeout(pending.current.timer);
      pending.current = null;
    }
    await edits.reset(ids);
    setDraft(null);
    for (const id of ids) livePreview.clear(id);
  }

  const known = luts.some((lut) => lut.id === current.lut_id);
  return (
    <Panel title="Corrección básica" icon="sliders">
      {SLIDERS.map(({ key, label }) => (
        <label key={key} className={styles.slider}>
          <span className={styles.row}>
            {label}
            <output className={styles.value}>{shown(key, current[key])}</output>
          </span>
          <input
            type="range"
            aria-label={label}
            min={key === "exposure" ? -2 : -1}
            max={key === "exposure" ? 2 : 1}
            step={key === "exposure" ? 0.05 : 0.01}
            value={current[key]}
            disabled={!photo}
            onChange={(event) => change({ [key]: Number(event.target.value) })}
            onDoubleClick={() => change({ [key]: 0 })}
          />
        </label>
      ))}

      <label className={styles.field}>
        LUT
        <select
          value={current.lut_id ?? ""}
          disabled={!photo}
          onChange={(event) => change({ lut_id: event.target.value || null })}
        >
          <option value="">Sin LUT</option>
          {current.lut_id && !known ? <option value={current.lut_id}>(LUT quitado)</option> : null}
          {luts.map((lut) => (
            <option key={lut.id} value={lut.id}>
              {lut.name}
            </option>
          ))}
        </select>
      </label>
      {current.lut_id ? (
        <label className={styles.slider}>
          <span className={styles.row}>
            Intensidad del LUT
            <output className={styles.value}>{Math.round(current.lut_strength * 100)} %</output>
          </span>
          <input
            type="range"
            aria-label="Intensidad del LUT"
            min={0}
            max={1}
            step={0.01}
            value={current.lut_strength}
            onChange={(event) => change({ lut_strength: Number(event.target.value) })}
          />
        </label>
      ) : null}

      <Button
        size="sm"
        disabled={!photo || isNeutral(current)}
        onClick={() => void restore(scopes.current)}
      >
        Restablecer esta foto
      </Button>

      <div className={styles.group}>
        <label className={styles.field}>
          Aplicar a
          <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
            {SCOPE_ORDER.map((id) => (
              <option key={id} value={id} disabled={scopes[id].length === 0}>
                {scopeText(id, scopes)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.buttons}>
          <Button
            variant="primary"
            size="sm"
            disabled={!photo || scopes[scope].length === 0}
            onClick={() => void copyToGroup()}
          >
            Aplicar al grupo
          </Button>
          <Button
            size="sm"
            disabled={scopes[scope].length === 0}
            onClick={() => void restore(scopes[scope])}
          >
            Quitar correcciones
          </Button>
        </div>
        <Button
          icon="download"
          disabled={scopes[scope].length === 0}
          onClick={() => {
            flush();
            onExport(scope);
          }}
        >
          Exportar…
        </Button>
      </div>
    </Panel>
  );
}
