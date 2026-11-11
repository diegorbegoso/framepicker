import { useEffect, useRef } from "react";
import { Badge } from "../../components/Badge.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { cx } from "../../lib/cx.ts";
import { fileName, type SelectedPhoto } from "../../lib/engine.ts";
import { usePreview } from "../../lib/previews.ts";
import styles from "./Filmstrip.module.css";

type Props = {
  photos: SelectedPhoto[];
  focused: number;
  onFocus: (index: number) => void;
};

function Thumb({
  photo,
  index,
  focused,
  onFocus,
  setRef,
}: {
  photo: SelectedPhoto;
  index: number;
  focused: boolean;
  onFocus: (index: number) => void;
  setRef: (index: number, node: HTMLButtonElement | null) => void;
}) {
  const { image } = usePreview(photo.id, "thumb", 1);
  const name = fileName(photo.path);
  return (
    <button
      ref={(node) => setRef(index, node)}
      type="button"
      data-thumb=""
      tabIndex={focused ? 0 : -1}
      aria-label={`${name}, ${photo.selected ? "elegida" : "no elegida"}`}
      aria-current={focused ? "true" : undefined}
      className={cx(styles.thumb, focused && styles.viewing, photo.selected && styles.picked)}
      onFocus={() => onFocus(index)}
      onClick={() => onFocus(index)}
    >
      <span className={styles.frame}>
        {image ? (
          <img src={image.url} alt="" draggable={false} />
        ) : (
          <Skeleton className={styles.fill} />
        )}
      </span>
      <span className={styles.caption}>
        <span className={styles.name}>{name}</span>
        {photo.selected ? (
          <Badge tone="success" icon="check" className={styles.badge}>
            Elegida
          </Badge>
        ) : null}
      </span>
    </button>
  );
}

/** The photos of the burst in a row. Clicking one shows it in the viewer; Space picks it. */
export function Filmstrip({ photos, focused, onFocus }: Props) {
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const setRef = (index: number, node: HTMLButtonElement | null) => {
    nodes.current[index] = node;
  };

  useEffect(() => {
    const node = nodes.current[focused];
    if (!node) return;
    node.scrollIntoView?.({ inline: "center", block: "nearest" });
    // Arrow keys move the focus along with the selection when it was already on the strip.
    const active = document.activeElement;
    if (active && active !== node && nodes.current.includes(active as HTMLButtonElement)) {
      node.focus({ preventScroll: true });
    }
  }, [focused]);

  return (
    <fieldset className={styles.root}>
      <legend className={styles.legend}>Fotos de la ráfaga</legend>
      {photos.map((photo, index) => (
        <Thumb
          key={photo.id}
          photo={photo}
          index={index}
          focused={index === focused}
          onFocus={onFocus}
          setRef={setRef}
        />
      ))}
    </fieldset>
  );
}
