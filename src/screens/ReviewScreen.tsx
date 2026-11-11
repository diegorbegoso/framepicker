import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { SelectedPhoto, SelectResult, Weights } from "../lib/engine.ts";
import * as engine from "../lib/engine.ts";
import { ExportPanel, panel } from "./ExportPanel.tsx";
import { button } from "./HomeScreen.tsx";

type Props = { sessionId: string; initial: SelectResult; onReset: () => void };

const WEIGHT_LABELS: [keyof Weights, string][] = [
  ["sharpness", "Peso de nitidez"],
  ["exposure", "Peso de exposición"],
  ["eyes", "Peso de ojos abiertos"],
];

const layout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "220px 1fr 260px",
  gap: "var(--space-5)",
  alignItems: "start",
};
const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "var(--space-3)",
};

function photoStyle(selected: boolean): CSSProperties {
  return {
    ...button(false),
    padding: "var(--space-2)",
    display: "grid",
    gap: "var(--space-2)",
    textAlign: "left",
    borderWidth: "2px",
    borderColor: selected ? "var(--primary)" : "var(--divider)",
  };
}

const percent = (value: number) => `${Math.round(value * 100)} %`;

function scoreRows({ scores }: SelectedPhoto): [string, string][] {
  const eyes = scores.eyes_open === null ? "sin rostro" : percent(scores.eyes_open);
  return [
    ["Nitidez relativa", percent(scores.sharpness_norm)],
    ["Exposición", percent(scores.exposure)],
    ["Ojos abiertos", eyes],
    ["Combinada", percent(scores.combined)],
  ];
}

export function ReviewScreen({ sessionId, initial, onReset }: Props) {
  const [bursts, setBursts] = useState(initial.bursts);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(0);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [perBurst, setPerBurst] = useState("1");
  const [weights, setWeights] = useState<Weights>({ sharpness: 0.6, exposure: 0.2, eyes: 0.2 });
  const [error, setError] = useState<string | null>(null);
  const photoRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const requested = useRef(new Set<string>());

  const burst = bursts[active];
  const photos = burst?.photos ?? [];
  const current: SelectedPhoto | undefined = photos[focused];
  const selectedCount = bursts.reduce((n, b) => n + b.photos.filter((p) => p.selected).length, 0);

  useEffect(() => {
    void engine
      .getSettings()
      .then((stored) => {
        setPerBurst(String(stored.per_burst));
        setWeights(stored.weights);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    for (const photo of photos) {
      if (requested.current.has(photo.id)) continue;
      requested.current.add(photo.id);
      void engine
        .preview(photo.id)
        .then((url) => setPreviews((known) => ({ ...known, [photo.id]: url })))
        .catch(() => undefined);
    }
  }, [photos]);

  function replacePhoto(photoId: string, patch: Partial<SelectedPhoto>) {
    setBursts((all) =>
      all.map((b, index) =>
        index !== active
          ? b
          : { ...b, photos: b.photos.map((p) => (p.id === photoId ? { ...p, ...patch } : p)) },
      ),
    );
  }

  async function toggle(photo: SelectedPhoto) {
    if (!burst) return;
    const next = !photo.selected;
    replacePhoto(photo.id, { selected: next, source: "user" });
    try {
      await engine.setPick(burst.id, photo.id, next);
      setError(null);
    } catch {
      replacePhoto(photo.id, { selected: photo.selected, source: photo.source });
      setError("No se pudo guardar la elección.");
    }
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined || photos.length === 0) return;
    event.preventDefault();
    const next = (focused + step + photos.length) % photos.length;
    setFocused(next);
    photoRefs.current[next]?.focus();
  }

  async function apply() {
    const count = Number.parseInt(perBurst, 10);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      setError("Fotos por ráfaga debe ser un número del 1 al 20.");
      return;
    }
    try {
      await engine.setSetting("per_burst", count);
      await engine.setSetting("weights", weights);
      setBursts((await engine.select(sessionId)).bursts);
      setError(null);
    } catch {
      setError("No se pudieron aplicar los ajustes.");
    }
  }

  return (
    <section aria-labelledby="review-title" style={{ display: "grid", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 id="review-title" style={{ margin: 0 }}>
          Revisa tus ráfagas
        </h2>
        <button type="button" style={button(false)} onClick={onReset}>
          Elegir otras fotos
        </button>
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--destructive)", margin: 0 }}>
          {error}
        </p>
      )}
      <div style={layout}>
        <nav aria-label="Ráfagas" style={panel}>
          {bursts.map((b, index) => (
            <button
              key={b.id}
              type="button"
              style={button(index === active)}
              aria-current={index === active ? "true" : undefined}
              onClick={() => {
                setActive(index);
                setFocused(0);
              }}
            >
              {`Ráfaga ${b.position + 1} · ${b.photos.length} fotos`}
            </button>
          ))}
        </nav>
        <div style={grid}>
          {photos.map((photo, index) => {
            const name = engine.fileName(photo.path);
            return (
              <button
                key={photo.id}
                ref={(node) => {
                  photoRefs.current[index] = node;
                }}
                type="button"
                tabIndex={index === focused ? 0 : -1}
                aria-label={`${name}, ${photo.selected ? "elegida" : "no elegida"}`}
                style={photoStyle(photo.selected)}
                onFocus={() => setFocused(index)}
                onKeyDown={moveFocus}
                onClick={() => void toggle(photo)}
              >
                {previews[photo.id] ? (
                  <img src={previews[photo.id]} alt="" style={{ width: "100%" }} />
                ) : (
                  <span style={{ color: "var(--fg-muted)" }}>Cargando vista previa…</span>
                )}
                <span>{name}</span>
                {photo.selected && (
                  <span style={{ color: "var(--success)", fontWeight: 600 }}>Elegida</span>
                )}
              </button>
            );
          })}
        </div>
        <aside style={{ display: "grid", gap: "var(--space-4)" }}>
          <section aria-label="Puntuaciones" style={panel}>
            <dl style={{ margin: 0, display: "grid", gap: "var(--space-2)" }}>
              {current
                ? scoreRows(current).flatMap(([term, value]) => [
                    <dt key={`t-${term}`}>{term}</dt>,
                    <dd key={`d-${term}`}>{value}</dd>,
                  ])
                : null}
            </dl>
          </section>
          <fieldset style={panel}>
            <legend>Ajustes de selección</legend>
            <label>
              Fotos por ráfaga{" "}
              <input
                type="number"
                min={1}
                max={20}
                value={perBurst}
                onChange={(event) => setPerBurst(event.target.value)}
              />
            </label>
            {WEIGHT_LABELS.map(([key, text]) => (
              <label key={key} style={{ display: "grid" }}>
                {text}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weights[key]}
                  onChange={(event) =>
                    setWeights((w) => ({ ...w, [key]: Number(event.target.value) }))
                  }
                />
              </label>
            ))}
            <button type="button" style={button(true)} onClick={() => void apply()}>
              Aplicar
            </button>
          </fieldset>
          <ExportPanel sessionId={sessionId} selectedCount={selectedCount} />
        </aside>
      </div>
    </section>
  );
}
