import { useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Panel } from "../../components/Panel.tsx";
import type { SelectedBurst, Weights } from "../../lib/engine.ts";
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

/** How many photos to keep per burst and how much each score counts; "Aplicar" selects again. */
export function SettingsPanel({ sessionId, onApplied, onError }: Props) {
  const [perBurst, setPerBurst] = useState("1");
  const [weights, setWeights] = useState<Weights>({ sharpness: 0.6, exposure: 0.2, eyes: 0.2 });

  useEffect(() => {
    void engine
      .getSettings()
      .then((stored) => {
        setPerBurst(String(stored.per_burst));
        setWeights(stored.weights);
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
      onApplied((await engine.select(sessionId)).bursts);
      onError(null);
    } catch {
      onError("No se pudieron aplicar los ajustes.");
    }
  }

  return (
    <Panel title="Ajustes de selección" icon="sliders">
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
            <output className={styles.value}>{Math.round(weights[key] * 100)} %</output>
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
      <Button variant="primary" onClick={() => void apply()}>
        Aplicar
      </Button>
    </Panel>
  );
}
