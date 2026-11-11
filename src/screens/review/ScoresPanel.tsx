import { Panel } from "../../components/Panel.tsx";
import type { SelectedPhoto } from "../../lib/engine.ts";
import styles from "./ScoresPanel.module.css";

const percent = (value: number) => `${Math.round(value * 100)} %`;

function rows({ scores }: SelectedPhoto): { term: string; value: string; share: number | null }[] {
  return [
    {
      term: "Nitidez relativa",
      value: percent(scores.sharpness_norm),
      share: scores.sharpness_norm,
    },
    { term: "Exposición", value: percent(scores.exposure), share: scores.exposure },
    {
      term: "Ojos abiertos",
      value: scores.eyes_open === null ? "sin rostro" : percent(scores.eyes_open),
      share: scores.eyes_open,
    },
    { term: "Combinada", value: percent(scores.combined), share: scores.combined },
  ];
}

/** Why the app liked this photo: each score and a bar to compare them at a glance. */
export function ScoresPanel({ photo }: { photo: SelectedPhoto | undefined }) {
  return (
    <Panel title="Puntuaciones" icon="eye">
      <dl className={styles.list}>
        {photo
          ? rows(photo).map(({ term, value, share }) => (
              <div key={term} className={styles.row}>
                <dt>{term}</dt>
                <dd>{value}</dd>
                <span className={styles.bar} aria-hidden="true">
                  <span
                    className={styles.fill}
                    style={{ width: `${Math.round(Math.min(1, Math.max(0, share ?? 0)) * 100)}%` }}
                  />
                </span>
              </div>
            ))
          : null}
      </dl>
    </Panel>
  );
}
