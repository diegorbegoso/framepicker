import { usePreview } from "../../lib/previews.ts";
import styles from "./ContactSheet.module.css";

type Props = {
  /** Photos of the person's sessions to show; frames without a photo stay as soft colour. */
  photos: string[];
};

const COLUMNS = [0, 1, 2] as const;
const ROWS = [0, 1, 2, 3, 4, 5] as const;
const TINTS = ["a", "b", "c"] as const;

function Frame({ photoId, tint }: { photoId: string | undefined; tint: (typeof TINTS)[number] }) {
  const { image } = usePreview(photoId, "thumb", 3);
  return (
    <span className={`${styles.frame} ${styles[tint]}`}>
      {image ? <img src={image.url} alt="" draggable={false} loading="lazy" /> : null}
    </span>
  );
}

/**
 * A contact sheet of tilted frames drifting slowly in opposite directions: the person's own
 * photos when there are some, colour until then. Decorative, so hidden from screen readers.
 */
export function ContactSheet({ photos }: Props) {
  return (
    <div className={styles.root} aria-hidden="true" data-testid="contact-sheet">
      {COLUMNS.map((column) => (
        <div key={column} className={`${styles.column} ${column === 1 ? styles.up : styles.down}`}>
          {ROWS.map((row) => {
            const index = column + row * COLUMNS.length;
            return (
              <Frame
                key={row}
                photoId={photos.length > 0 ? photos[index % photos.length] : undefined}
                tint={TINTS[(column + row) % TINTS.length] ?? "a"}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
