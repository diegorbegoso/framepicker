import { NumberField } from "../../components/NumberField.tsx";
import type { Adjustments, LutInfo } from "../../lib/engine.ts";
import styles from "./CorrectionsPanel.module.css";

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

type Props = {
  current: Adjustments;
  disabled: boolean;
  luts: LutInfo[];
  onChange: (patch: Partial<Adjustments>) => void;
};

/** The sliders (each with a number you can type), and the LUT with its strength. */
export function ManualControls({ current, disabled, luts, onChange }: Props) {
  const change = onChange;
  const photo = !disabled;
  const known = luts.some((lut) => lut.id === current.lut_id);
  return (
    <>
      {SLIDERS.map(({ key, label }) => {
        // Exposure is in stops; the rest are shown from -100 to 100, like the sliders of an editor.
        const scale = key === "exposure" ? 1 : 100;
        return (
          <div key={key} className={styles.slider}>
            <span className={styles.row}>
              {label}
              <NumberField
                label={`${label} (valor)`}
                value={current[key] * scale}
                min={(key === "exposure" ? -2 : -1) * scale}
                max={(key === "exposure" ? 2 : 1) * scale}
                step={key === "exposure" ? 0.1 : 1}
                unit={key === "exposure" ? "EV" : undefined}
                disabled={!photo}
                onChange={(next) => change({ [key]: next / scale })}
              />
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
          </div>
        );
      })}

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
        <div className={styles.slider}>
          <span className={styles.row}>
            Intensidad del LUT
            <NumberField
              label="Intensidad del LUT (valor)"
              value={current.lut_strength * 100}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(next) => change({ lut_strength: next / 100 })}
            />
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
        </div>
      ) : null}
    </>
  );
}
