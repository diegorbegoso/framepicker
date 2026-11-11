import { useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Panel } from "../../components/Panel.tsx";
import type { MinQuality, SelectedBurst, Weights } from "../../lib/engine.ts";
import * as engine from "../../lib/engine.ts";
import styles from "./SettingsPanel.module.css";

const WEIGHT_LABELS: [keyof Weights, string][] = [
  ["sharpness", "Peso de nitidez"],
  ["exposure", "Peso de exposición"],
  ["eyes", "Peso de ojos abiertos"],
];

type Props = {
  sessionId: string;
  onApplied: (bursts: SelectedBurst[]) => void;
  onError: (message: string | null) => void;
};

const percent = (value: number) => `${Math.round(value * 100)} %`;

/** Summary of what the current picks look like, shown after "Aplicar". */
function summarize(bursts: SelectedBurst[]): string {
  const picked = bursts.reduce((n, b) => n + b.photos.filter((p) => p.selected).length, 0);
  const none = bursts.filter((b) => !b.photos.some((p) => p.selected)).length;
  return `Quedaron ${picked} elegidas. ${none} ${none === 1 ? "ráfaga sin ninguna" : "ráfagas sin ninguna"}.`;
}

/**
 * Two questions, kept apart: can a photo be picked at all (minimums), and which of those wins
 * (weights). "Aplicar" selects again, leaving alone the bursts the person already confirmed.
 */
export function SettingsPanel({ sessionId, onApplied, onError }: Props) {
  const [perBurst, setPerBurst] = useState("1");
  const [weights, setWeights] = useState<Weights>({ sharpness: 0.6, exposure: 0.2, eyes: 0.2 });
  const [minimums, setMinimums] = useState<MinQuality>({
    sharpness: 90,
    exposure: 0.55,
    eyes: 0.4,
  });
  const [summary, setSummary] = useState("");

  useEffect(() => {
    void engine
      .getSettings()
      .then((stored) => {
        setPerBurst(String(stored.per_burst));
        setWeights(stored.weights);
        setMinimums(stored.min_quality);
      })
      .catch(() => undefined);
  }, []);

  async function apply() {
    const count = Number.parseInt(perBurst, 10);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      onError("Fotos por ráfaga debe ser un número del 1 al 20.");
      return;
    }
    try {
      await engine.setSetting("per_burst", count);
      await engine.setSetting("weights", weights);
      await engine.setSetting("min_quality", minimums);
      const next = (await engine.select(sessionId)).bursts;
      onApplied(next);
      setSummary(summarize(next));
      onError(null);
    } catch {
      onError("No se pudieron aplicar los ajustes.");
    }
  }

  return (
    <Panel title="Ajustes de selección" icon="sliders">
      <section className={styles.group} aria-label="Mínimos de calidad">
        <h4 className={styles.heading}>Mínimos</h4>
        <p className={styles.help}>
          Una foto que no llega a estos mínimos no se elige sola, aunque sea la única de su ráfaga.
          Con 0 se desactiva el mínimo.
        </p>
        <label className={styles.field}>
          Nitidez mínima
          <input
            type="number"
            min={0}
            value={minimums.sharpness}
            className={styles.number}
            onChange={(event) =>
              setMinimums((m) => ({ ...m, sharpness: Number(event.target.value) || 0 }))
            }
          />
        </label>
        {(
          [
            ["exposure", "Exposición mínima"],
            ["eyes", "Ojos abiertos mínimos"],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className={styles.slider}>
            <span className={styles.sliderText}>
              {text}
              <output className={styles.value}>{percent(minimums[key])}</output>
            </span>
            <input
              type="range"
              aria-label={text}
              min={0}
              max={1}
              step={0.05}
              value={minimums[key]}
              onChange={(event) =>
                setMinimums((m) => ({ ...m, [key]: Number(event.target.value) }))
              }
            />
          </label>
        ))}
      </section>

      <section className={styles.group} aria-label="Orden dentro de la ráfaga">
        <h4 className={styles.heading}>Orden</h4>
        <p className={styles.help}>
          De las fotos que cumplen, gana la de mejor nota. Los pesos dicen qué cuenta más.
        </p>
        <label className={styles.field}>
          Fotos por ráfaga
          <input
            type="number"
            min={1}
            max={20}
            value={perBurst}
            className={styles.number}
            onChange={(event) => setPerBurst(event.target.value)}
          />
        </label>
        {WEIGHT_LABELS.map(([key, text]) => (
          <label key={key} className={styles.slider}>
            <span className={styles.sliderText}>
              {text}
              <output className={styles.value}>{percent(weights[key])}</output>
            </span>
            <input
              type="range"
              aria-label={text}
              min={0}
              max={1}
              step={0.05}
              value={weights[key]}
              onChange={(event) => setWeights((w) => ({ ...w, [key]: Number(event.target.value) }))}
            />
          </label>
        ))}
      </section>

      <Button variant="primary" onClick={() => void apply()}>
        Aplicar
      </Button>
      <p role="status" className={styles.help}>
        {summary}
      </p>
    </Panel>
  );
}
