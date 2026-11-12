import { useEffect, useState } from "react";
import { Icon } from "../../../components/Icon.tsx";
import { cx } from "../../../lib/cx.ts";
import type { Adjustments, LutInfo } from "../../../lib/engine.ts";
import { loadThumb, peekThumb } from "../../../lib/lutThumbs.ts";
import { useInView } from "../../../lib/useInView.ts";
import styles from "./LutGallery.module.css";

type Props = {
  photoId: string;
  /** The photo's corrections: the thumbnail shows them with this LUT on top. */
  adjustments: Adjustments;
  /** null: the "no LUT" tile. */
  lut: LutInfo | null;
  active: boolean;
  onPick: () => void;
  onHover: (on: boolean) => void;
  onFavorite?: () => void;
};

/** One choice in the gallery: the photo with the LUT on it, its name and a star. */
export function LutTile({ photoId, adjustments, lut, active, onPick, onHover, onFavorite }: Props) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const lutId = lut?.id ?? null;
  const [url, setUrl] = useState<string | undefined>(() => peekThumb(photoId, adjustments, lutId));
  const name = lut?.name ?? "Ninguno";

  useEffect(() => {
    if (!seen) return;
    let live = true;
    loadThumb(photoId, adjustments, lutId)
      .then((found) => live && setUrl(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [seen, photoId, adjustments, lutId]);

  return (
    <div ref={ref} className={cx(styles.tile, active && styles.active)}>
      <button
        type="button"
        data-lut-tile=""
        data-lut={lutId ?? ""}
        className={styles.pick}
        aria-pressed={active}
        aria-label={name}
        title={lut?.group ? `${lut.group} · ${name}` : name}
        onClick={onPick}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
      >
        <span className={styles.thumb}>
          {url ? <img src={url} alt="" draggable={false} /> : <span className={styles.wait} />}
        </span>
        <span className={styles.name}>{name}</span>
      </button>
      {lut && onFavorite ? (
        <button
          type="button"
          className={cx(styles.star, lut.favorite && styles.starOn)}
          aria-label={lut.favorite ? `Quitar de favoritos ${name}` : `Marcar como favorito ${name}`}
          aria-pressed={lut.favorite}
          onClick={onFavorite}
        >
          <Icon name="star" size={14} />
        </button>
      ) : null}
    </div>
  );
}
