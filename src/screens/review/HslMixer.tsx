import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { NumberField } from "../../components/NumberField.tsx";
import { cx } from "../../lib/cx.ts";
import { HSL_COLORS, type Hsl, type HslColor, neutralHsl } from "../../lib/engine.ts";
import styles from "./HslMixer.module.css";

const NAMES: Record<HslColor, string> = {
  red: "Rojo",
  orange: "Naranja",
  yellow: "Amarillo",
  green: "Verde",
  aqua: "Agua",
  blue: "Azul",
  purple: "Morado",
  magenta: "Magenta",
};
const CHANNELS = ["Tono", "Saturación", "Luminosidad"] as const;

type Props = {
  hsl: Hsl;
  disabled: boolean;
  onChange: (hsl: Hsl) => void;
};

/** Colour mixer: pick one of eight colours, then move its hue, saturation and brightness. */
export function HslMixer({ hsl, disabled, onChange }: Props) {
  const [color, setColor] = useState<HslColor>("red");
  const values = hsl[color];
  const touched = HSL_COLORS.some((id) => hsl[id].some((n) => n !== 0));

  function set(channel: number, next: number) {
    const triple: [number, number, number] = [values[0], values[1], values[2]];
    triple[channel] = next;
    onChange({ ...hsl, [color]: triple });
  }

  return (
    <div className={styles.root}>
      <div role="toolbar" aria-label="Color a mezclar" className={styles.swatches}>
        {HSL_COLORS.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={NAMES[id]}
            aria-pressed={color === id}
            title={NAMES[id]}
            className={cx(styles.swatch, styles[id], color === id && styles.on)}
            onClick={() => setColor(id)}
          >
            {hsl[id].some((n) => n !== 0) ? <span className={styles.mark} /> : null}
          </button>
        ))}
      </div>
      {CHANNELS.map((name, channel) => (
        <div key={name} className={styles.slider}>
          <span className={styles.row}>
            {name}
            <NumberField
              label={`${name} de ${NAMES[color]} (valor)`}
              value={(values[channel] ?? 0) * 100}
              min={-100}
              max={100}
              step={1}
              disabled={disabled}
              onChange={(next) => set(channel, next / 100)}
            />
          </span>
          <input
            type="range"
            aria-label={`${name} de ${NAMES[color]}`}
            min={-1}
            max={1}
            step={0.01}
            value={values[channel] ?? 0}
            disabled={disabled}
            onChange={(event) => set(channel, Number(event.target.value))}
            onDoubleClick={() => set(channel, 0)}
          />
        </div>
      ))}
      <Button size="sm" disabled={disabled || !touched} onClick={() => onChange(neutralHsl())}>
        Restablecer colores
      </Button>
    </div>
  );
}
