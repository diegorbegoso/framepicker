import { Button } from "../../components/Button.tsx";
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
import { LutRow } from "./lut/LutRow.tsx";
import { Section } from "./Section.tsx";
import { SliderRow } from "./SliderRow.tsx";
import { SLIDER_GROUPS, SLIDER_SPECS } from "./sliders.ts";

type Props = {
  current: Adjustments;
  hasPhoto: boolean;
  photoId: string | undefined;
  luts: LutInfo[];
  whiteBalance: boolean;
  onWhiteBalance: (on: boolean) => void;
  autoBusy: boolean;
  onAuto: () => void;
  onChange: (patch: Partial<Adjustments>) => void;
  onCrop: () => void;
  onRestore: () => void;
  onHoverLut: (lutId: string | null | undefined) => void;
  onLutsChanged: () => void;
};

/** Everything that can be done to the photo on screen, in folding sections. */
export function PhotoTab({
  current,
  hasPhoto,
  photoId,
  luts,
  whiteBalance,
  onWhiteBalance,
  autoBusy,
  onAuto,
  onChange,
  onCrop,
  onRestore,
  onHoverLut,
  onLutsChanged,
}: Props) {
  const disabled = !hasPhoto;
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
        <LutRow
          photoId={photoId}
          current={current}
          luts={luts}
          onChange={onChange}
          onHover={onHoverLut}
          onLutsChanged={onLutsChanged}
        />
      </Section>

      <Button size="sm" disabled={disabled || isNeutral(current)} onClick={onRestore}>
        Restablecer esta foto
      </Button>
    </div>
  );
}
