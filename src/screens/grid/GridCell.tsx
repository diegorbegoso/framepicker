import { Icon } from "../../components/Icon.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { cx } from "../../lib/cx.ts";
import { fileName } from "../../lib/engine.ts";
import { usePreview } from "../../lib/previews.ts";
import { useInView } from "../../lib/useInView.ts";
import styles from "./GridCell.module.css";
import { FAIL_TEXT, type GridItem } from "./items.ts";

type Props = {
  item: GridItem;
  focused: boolean;
  /** In the group marked to act on together. */
  marked: boolean;
  /** Carries corrections or a LUT. */
  edited: boolean;
  setRef: (id: string, node: HTMLDivElement | null) => void;
  /** `anchored` is true for a plain click, which also becomes the start of the next range. */
  onFocus: (id: string, anchored: boolean) => void;
  onOpen: (id: string) => void;
  /** Ctrl+click toggles the mark; Shift+click marks a range from the last photo. */
  onMark: (id: string, how: "toggle" | "range") => void;
  /** `range` is true with Shift: pick or drop everything from the last cell to this one. */
  onPick: (id: string, range: boolean) => void;
};

/** One photo of the grid. The picture shows it; the round button in the corner picks it. */
export function GridCell({
  item,
  focused,
  marked,
  edited,
  setRef,
  onFocus,
  onOpen,
  onMark,
  onPick,
}: Props) {
  const { photo } = item;
  const { ref, seen } = useInView<HTMLDivElement>();
  const { image } = usePreview(seen ? photo.id : undefined, "thumb", 2);
  const name = fileName(photo.path);
  const low = photo.fails.length > 0;
  const lowText = photo.fails.map((fail) => FAIL_TEXT[fail]).join(" y ");
  return (
    <div
      ref={(node) => {
        ref.current = node;
        setRef(photo.id, node);
      }}
      className={cx(
        styles.cell,
        photo.selected && styles.picked,
        focused && styles.focused,
        marked && styles.marked,
      )}
    >
      <button
        type="button"
        data-cell=""
        tabIndex={focused ? 0 : -1}
        aria-label={`${name}, ${photo.selected ? "elegida" : "no elegida"}${
          low ? `, bajo el mínimo de ${lowText}` : ""
        }${marked ? ", marcada" : ""}`}
        aria-current={focused ? "true" : undefined}
        className={styles.picture}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey) onMark(photo.id, "toggle");
          else if (event.shiftKey) onMark(photo.id, "range");
          else onFocus(photo.id, true);
        }}
        onDoubleClick={() => onOpen(photo.id)}
        onFocus={() => onFocus(photo.id, false)}
      >
        {image ? (
          <img src={image.url} alt="" draggable={false} />
        ) : (
          <Skeleton className={styles.fill} />
        )}
      </button>
      <button
        type="button"
        aria-pressed={photo.selected}
        aria-label={`${photo.selected ? "Quitar" : "Elegir"} ${name}`}
        className={styles.check}
        onClick={(event) => onPick(photo.id, event.shiftKey)}
      >
        <Icon name={photo.selected ? "circle-check" : "circle"} size={22} />
      </button>
      {edited ? (
        <span className={styles.edited} title="Tiene correcciones">
          <Icon name="sliders" size={14} />
        </span>
      ) : null}
      {item.first ? <span className={styles.burst}>Ráfaga {item.burstNumber}</span> : null}
      {low ? (
        <span className={styles.low} title={`Bajo el mínimo de ${lowText}`}>
          <Icon name="alert" size={14} />
        </span>
      ) : null}
    </div>
  );
}
