import { Button } from "../../../components/Button.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NumberField } from "../../../components/NumberField.tsx";
import { ASPECTS } from "../../../lib/geometry.ts";
import styles from "./CropEditor.module.css";

type Props = {
  aspect: string | null;
  angle: number;
  disabled: boolean;
  onAspect: (aspect: string | null) => void;
  onTurnAspect: () => void;
  onAngle: (angle: number) => void;
  onTurn: (direction: 1 | -1) => void;
  onFlip: () => void;
  onAuto: () => void;
  onReset: () => void;
};

/** The controls beside the picture: proportion, angle, quarter turns, mirror and reset. */
export function CropBar({
  aspect,
  angle,
  disabled,
  onAspect,
  onTurnAspect,
  onAngle,
  onTurn,
  onFlip,
  onAuto,
  onReset,
}: Props) {
  const current = aspect ?? "libre";
  const known = ASPECTS.some((item) => item.id === current);
  return (
    <div className={styles.bar}>
      <div role="toolbar" aria-label="Proporción" className={styles.chips}>
        {ASPECTS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.chip}
            aria-pressed={current === item.id}
            disabled={disabled}
            onClick={() => onAspect(item.id === "libre" ? null : item.id)}
          >
            {item.label}
          </button>
        ))}
        {known ? null : (
          <button type="button" className={styles.chip} aria-pressed disabled>
            {current}
          </button>
        )}
      </div>
      <Button
        size="sm"
        disabled={disabled || current === "libre"}
        onClick={onTurnAspect}
        aria-label="Girar la orientación de la proporción"
      >
        Horizontal ⇄ vertical
      </Button>

      <div className={styles.angle}>
        <span className={styles.row}>
          Ángulo
          <NumberField
            label="Ángulo (valor)"
            value={angle}
            min={-45}
            max={45}
            step={0.1}
            unit="°"
            disabled={disabled}
            onChange={onAngle}
          />
        </span>
        <input
          type="range"
          aria-label="Ángulo"
          min={-45}
          max={45}
          step={0.1}
          value={angle}
          disabled={disabled}
          onChange={(event) => onAngle(Number(event.target.value))}
          onDoubleClick={() => onAngle(0)}
        />
        <Button size="sm" icon="sparkle" disabled={disabled} onClick={onAuto}>
          Enderezar automático
        </Button>
      </div>

      <div className={styles.turns}>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onTurn(-1)}
          aria-label="Girar 90° a la izquierda"
        >
          <Icon name="rotate-ccw" size={16} /> 90°
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onTurn(1)}
          aria-label="Girar 90° a la derecha"
        >
          <Icon name="rotate-cw" size={16} /> 90°
        </Button>
        <Button size="sm" disabled={disabled} onClick={onFlip} aria-label="Voltear en espejo">
          <Icon name="flip" size={16} /> Espejo
        </Button>
      </div>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onReset}>
        Restablecer
      </Button>
    </div>
  );
}
