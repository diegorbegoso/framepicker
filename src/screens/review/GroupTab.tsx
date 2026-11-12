import { type ReactNode, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { AutoGroup } from "./AutoCorrect.tsx";
import styles from "./GroupTab.module.css";
import { SCOPE_ORDER, type Scope, type ScopeIds, scopeText } from "./scopes.ts";

type Props = {
  scope: Scope;
  scopes: ScopeIds;
  hasPhoto: boolean;
  onScope: (scope: Scope) => void;
  /** Gives those photos the settings of the one on screen; `withGeometry` brings its crop and turn. */
  onCopy: (withGeometry: boolean) => void;
  onClear: () => void;
  onExport: () => void;
  whiteBalance: boolean;
  onWhiteBalance: (on: boolean) => void;
  running: { done: number; total: number } | null;
  message: string | null;
  canUndo: boolean;
  onRunAuto: () => void;
  onCancelAuto: () => void;
  onUndoAuto: () => void;
};

function Card({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <section className={styles.card}>
      <h4 className={styles.cardTitle}>{title}</h4>
      <p className={styles.help}>{help}</p>
      {children}
    </section>
  );
}

const photos = (n: number) => (n === 1 ? "1 foto" : `${n} fotos`);

/** What can be done to many photos at once, starting with which photos they are. */
export function GroupTab({
  scope,
  scopes,
  hasPhoto,
  onScope,
  onCopy,
  onClear,
  onExport,
  whiteBalance,
  onWhiteBalance,
  running,
  message,
  canUndo,
  onRunAuto,
  onCancelAuto,
  onUndoAuto,
}: Props) {
  const [withGeometry, setWithGeometry] = useState(false);
  const count = scopes[scope].length;
  return (
    <div className={styles.tab}>
      <label className={styles.scope}>
        <span className={styles.scopeLabel}>¿A qué fotos?</span>
        <select value={scope} onChange={(event) => onScope(event.target.value as Scope)}>
          {SCOPE_ORDER.map((id) => (
            <option key={id} value={id} disabled={scopes[id].length === 0}>
              {scopeText(id, scopes)}
            </option>
          ))}
        </select>
      </label>

      <Card
        title="Copiar los ajustes de esta foto"
        help="Deja esas fotos con los mismos valores que tiene la foto en pantalla."
      >
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={withGeometry}
            onChange={(event) => setWithGeometry(event.target.checked)}
          />
          Incluir recorte y giro
        </label>
        <Button
          variant="primary"
          size="sm"
          disabled={!hasPhoto || count === 0}
          onClick={() => onCopy(withGeometry)}
        >
          {`Aplicar a ${photos(count)}`}
        </Button>
      </Card>

      <Card
        title="Corrección automática por ráfaga"
        help="Mide cada ráfaga y le da a todas sus fotos la misma corrección básica. Puedes deshacerla."
      >
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={whiteBalance}
            onChange={(event) => onWhiteBalance(event.target.checked)}
          />
          Balance de blancos
        </label>
        <AutoGroup
          count={count}
          running={running}
          message={message}
          canUndo={canUndo}
          onRun={onRunAuto}
          onCancel={onCancelAuto}
          onUndo={onUndoAuto}
        />
      </Card>

      <Card title="Quitar correcciones" help="Devuelve esas fotos a como salieron de la cámara.">
        <Button size="sm" disabled={count === 0} onClick={onClear}>
          Quitar correcciones
        </Button>
      </Card>

      <Card title="Exportar" help="Guarda esas fotos en otra carpeta, con o sin correcciones.">
        <Button icon="download" disabled={count === 0} onClick={onExport}>
          Exportar…
        </Button>
      </Card>
    </div>
  );
}
