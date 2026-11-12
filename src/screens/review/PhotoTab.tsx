import { Button } from "../../components/Button.tsx";
import { NumberField } from "../../components/NumberField.tsx";
import {
  type Adjustments,
  hasCurves,
  hasGeometry,
  hasMixer,
  isNeutral,
  type LutInfo,
} from "../../lib/engine.ts";
import { AutoTop } from "./AutoCorrect.tsx";
import styles from "./CorrectionsPanel.module.css";
import { CurvesEditor } from "./CurvesEditor.tsx";
import { HslMixer } from "./HslMixer.tsx";
import { Section } from "./Section.tsx";
import { SliderRow } from "./SliderRow.tsx";
import { SLIDER_GROUPS, SLIDER_SPECS } from "./sliders.ts";

type Props = {
  current: Adjustments;
  hasPhoto: boolean;
  luts: LutInfo[];
  whiteBalance: boolean;
  onWhiteBalance: (on: boolean) => void;
  autoBusy: boolean;
  onAuto: () => void;
  onChange: (patch: Partial<Adjustments>) => void;
  onCrop: () => void;
  onRestore: () => void;
};

/** Everything that can be done to the photo on screen, in folding sections. */
export function PhotoTab({
  current,
  hasPhoto,
  luts,
  whiteBalance,
  onWhiteBalance,
  autoBusy,
  onAuto,
  onChange,
  onCrop,
  onRestore,
}: Props) {
  const disabled = !hasPhoto;
  const known = luts.some((lut) => lut.id === current.lut_id);
  return (
    <div className={styles.tab}>
      <AutoTop
        whiteBalance={whiteBalance}
        onWhiteBalance={onWhiteBalance}
        disabled={disabled}
        busy={autoBusy}
        onAuto={onAuto}
      />

      {SLIDER_GROUPS.map((group) => (
        <Section
          key={group.id}
          title={group.title}
          defaultOpen={group.id === "light"}
          changed={group.keys.some((key) => current[key] !== 0)}
        >
          {group.keys.map((key) => (
            <SliderRow
              key={key}
              spec={SLIDER_SPECS[key]}
              value={current[key]}
              disabled={disabled}
              onChange={(value) => onChange({ [key]: value })}
            />
          ))}
        </Section>
      ))}

      <Section title="Curvas" changed={hasCurves(current)}>
        <CurvesEditor
          curves={current.curves}
          disabled={disabled}
          onChange={(curves) => onChange({ curves })}
        />
      </Section>

      <Section title="Mezcla de color" changed={hasMixer(current)}>
        <HslMixer hsl={current.hsl} disabled={disabled} onChange={(hsl) => onChange({ hsl })} />
      </Section>

      <Section title="Recorte y giro" changed={hasGeometry(current)}>
        <p className={styles.help}>
          Endereza la foto, córtala con la proporción que quieras, gírala o voltéala.
        </p>
        <Button size="sm" icon="crop" disabled={disabled} onClick={onCrop}>
          Recortar y enderezar…
        </Button>
      </Section>

      <Section title="LUT" changed={current.lut_id !== null}>
        <label className={styles.field}>
          LUT
          <select
            value={current.lut_id ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ lut_id: event.target.value || null })}
          >
            <option value="">Sin LUT</option>
            {current.lut_id && !known ? (
              <option value={current.lut_id}>(LUT quitado)</option>
            ) : null}
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
          </div>
        ) : null}
      </Section>

      <Button size="sm" disabled={disabled || isNeutral(current)} onClick={onRestore}>
        Restablecer esta foto
      </Button>
    </div>
  );
}
