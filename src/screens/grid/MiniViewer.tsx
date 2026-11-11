import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Panel } from "../../components/Panel.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { fileName } from "../../lib/engine.ts";
import { usePreview } from "../../lib/previews.ts";
import { ScoresPanel } from "../review/ScoresPanel.tsx";
import { FAIL_TEXT, type GridItem } from "./items.ts";
import styles from "./MiniViewer.module.css";

type Props = {
  item: GridItem | undefined;
  onOpen: () => void;
  onPick: () => void;
  onOpenInBurst: () => void;
};

/** The sidebar's small viewer: the focused photo, its scores and the actions on it. */
export function MiniViewer({ item, onOpen, onPick, onOpenInBurst }: Props) {
  const photo = item?.photo;
  const { image } = usePreview(photo?.id, "view", 0);
  if (!item || !photo) {
    return (
      <Panel title="Foto" icon="eye">
        <p className={styles.empty}>No hay fotos con este filtro.</p>
      </Panel>
    );
  }
  const name = fileName(photo.path);
  const low = photo.fails.map((fail) => FAIL_TEXT[fail]).join(" y ");
  return (
    <>
      <Panel title="Foto" icon="eye">
        <div className={styles.frame}>
          {image ? (
            <img src={image.url} alt={`Foto ${name}`} draggable={false} />
          ) : (
            <Skeleton className={styles.fill} />
          )}
        </div>
        <p className={styles.name}>
          {name}
          <span className={styles.where}>Ráfaga {item.burstNumber}</span>
        </p>
        <div className={styles.badges}>
          {photo.selected ? (
            <Badge tone="success" icon="check">
              Elegida
            </Badge>
          ) : null}
          {low ? <Badge icon="alert">Bajo el mínimo de {low}</Badge> : null}
        </div>
        <div className={styles.actions}>
          <Button
            variant={photo.selected ? "secondary" : "primary"}
            icon={photo.selected ? "check" : undefined}
            aria-keyshortcuts="Space"
            onClick={onPick}
          >
            {photo.selected ? "Quitar elección" : "Elegir esta foto"}
          </Button>
          <Button icon="zoom-in" aria-keyshortcuts="Enter" onClick={onOpen}>
            Ampliar
          </Button>
          <Button variant="ghost" icon="columns" onClick={onOpenInBurst}>
            Ver en su ráfaga
          </Button>
        </div>
      </Panel>
      <ScoresPanel photo={photo} />
    </>
  );
}
