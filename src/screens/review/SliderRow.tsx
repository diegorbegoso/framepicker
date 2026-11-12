import { NumberField } from "../../components/NumberField.tsx";
import styles from "./CorrectionsPanel.module.css";
import type { SliderSpec } from "./sliders.ts";

type Props = {
  spec: SliderSpec;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

/** One slider with the number beside it. Exposure shows stops; the rest show -100 to 100. */
export function SliderRow({ spec, value, disabled, onChange }: Props) {
  const stops = spec.key === "exposure";
  const scale = stops ? 1 : 100;
  return (
    <div className={styles.slider}>
      <span className={styles.row}>
        {spec.label}
        <NumberField
          label={`${spec.label} (valor)`}
          value={value * scale}
          min={spec.min * scale}
          max={spec.max * scale}
          step={stops ? 0.1 : 1}
          unit={stops ? "EV" : undefined}
          disabled={disabled}
          onChange={(next) => onChange(next / scale)}
        />
      </span>
      <input
        type="range"
        aria-label={spec.label}
        min={spec.min}
        max={spec.max}
        step={stops ? 0.05 : 0.01}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(0)}
      />
    </div>
  );
}
