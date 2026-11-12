import { useEffect, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { NumberField } from "../../../components/NumberField.tsx";
import { type Adjustments, type LutInfo, updateLut } from "../../../lib/engine.ts";
import { loadThumb, peekThumb } from "../../../lib/lutThumbs.ts";
import styles from "../CorrectionsPanel.module.css";
import { LutGallery } from "./LutGallery.tsx";
import rowStyles from "./LutRow.module.css";

type Props = {
  photoId: string | undefined;
  current: Adjustments;
  luts: LutInfo[];
  onChange: (patch: Partial<Adjustments>) => void;
  onHover: (lutId: string | null | undefined) => void;
  onLutsChanged: () => void;
};

/** The LUT of the photo on screen: how it looks, its strength, and the gallery to change it. */
export function LutRow({ photoId, current, luts, onChange, onHover, onLutsChanged }: Props) {
  const [open, setOpen] = useState(false);
  const lut = luts.find((item) => item.id === current.lut_id) ?? null;
  const missing = current.lut_id !== null && lut === null;
  const [thumb, setThumb] = useState<string | undefined>();

  useEffect(() => {
    if (!photoId || !lut) {
      setThumb(undefined);
      return;
    }
    setThumb(peekThumb(photoId, current, lut.id));
    let live = true;
    loadThumb(photoId, current, lut.id)
      .then((url) => live && setThumb(url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [photoId, current, lut]);

  async function favorite(item: LutInfo) {
    try {
      await updateLut(item.id, { favorite: !item.favorite });
      onLutsChanged();
    } catch {
      // The star stays as it was; nothing else depends on it.
    }
  }

  return (
    <div className={rowStyles.root}>
      <div className={rowStyles.current}>
        <span className={rowStyles.thumb}>{thumb ? <img src={thumb} alt="" /> : null}</span>
        <span className={rowStyles.text}>
          <span className={rowStyles.name}>
            {lut ? lut.name : missing ? "(LUT quitado)" : "Sin LUT"}
          </span>
          {lut?.group ? <span className={rowStyles.group}>{lut.group}</span> : null}
        </span>
      </div>
      <div className={rowStyles.buttons}>
        <Button size="sm" icon="sparkle" disabled={!photoId} onClick={() => setOpen(true)}>
          Elegir LUT…
        </Button>
        {current.lut_id ? (
          <Button size="sm" variant="ghost" onClick={() => onChange({ lut_id: null })}>
            Quitar LUT
          </Button>
        ) : null}
      </div>
      {current.lut_id && !open ? (
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
      {open && photoId ? (
        <LutGallery
          photoId={photoId}
          current={current}
          luts={luts}
          onChange={onChange}
          onHover={onHover}
          onFavorite={(item) => void favorite(item)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
