import { useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import type { OrganizePreview } from "../../lib/engine.ts";
import * as engine from "../../lib/engine.ts";
import styles from "./OrganizeDialog.module.css";

type Props = {
  sessionId: string;
  /** The last organisation that can still be undone, if any. */
  batchId: string | null;
  onBatch: (batchId: string | null) => void;
  onClose: () => void;
};

const DEFAULT_NAME = "No elegidas";
const PATH_NOT_ALLOWED = "Esa carpeta ya no está permitida. Vuelve a elegirla desde Inicio.";
const BAD_NAME = "Ese nombre de carpeta no es válido.";

function failure(error: unknown): string {
  if (error instanceof engine.EngineError) {
    if (error.code === engine.PATH_NOT_ALLOWED) return PATH_NOT_ALLOWED;
    if (error.code === -32602) return BAD_NAME;
  }
  return "No se pudo ordenar la carpeta.";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Keeps the chosen photos where they are and moves the rest into a subfolder. Nothing is deleted,
 * the person sees what will happen first, and it can be undone.
 */
export function OrganizeDialog({ sessionId, batchId, onBatch, onClose }: Props) {
  const [name, setName] = useState(DEFAULT_NAME);
  const [preview, setPreview] = useState<OrganizePreview | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setError(null);
    engine
      .organizePreview(sessionId, name.trim() || DEFAULT_NAME)
      .then((next) => current && setPreview(next))
      .catch((problem: unknown) => current && setError(failure(problem)));
    return () => {
      current = false;
    };
  }, [sessionId, name]);

  async function organize() {
    setWorking(true);
    setError(null);
    try {
      const result = await engine.organizeApply(sessionId, name.trim() || DEFAULT_NAME);
      onBatch(result.moved > 0 ? result.batch_id : null);
      const failed =
        result.failed > 0
          ? ` ${plural(result.failed, "no se pudo mover", "no se pudieron mover")}.`
          : "";
      setDone(
        result.moved === 0
          ? `No había nada que mover.${failed}`
          : `Listo: se movieron ${result.moved} archivos a «${name.trim() || DEFAULT_NAME}».${failed}`,
      );
      setPreview(await engine.organizePreview(sessionId, name.trim() || DEFAULT_NAME));
    } catch (problem) {
      setError(failure(problem));
    } finally {
      setWorking(false);
    }
  }

  async function undo() {
    if (!batchId) return;
    setWorking(true);
    setError(null);
    try {
      const result = await engine.organizeUndo(batchId);
      onBatch(null);
      const left =
        result.skipped > 0
          ? ` ${plural(result.skipped, "archivo se dejó donde estaba", "archivos se dejaron donde estaban")}.`
          : "";
      setDone(`Se devolvieron ${result.restored} archivos a su lugar.${left}`);
      setPreview(await engine.organizePreview(sessionId, name.trim() || DEFAULT_NAME));
    } catch (problem) {
      setError(failure(problem));
    } finally {
      setWorking(false);
    }
  }

  const toMove = preview?.to_move ?? 0;
  return (
    <Dialog title="Ordenar carpeta" onClose={onClose}>
      <p className={styles.help}>
        Deja en la carpeta solo las fotos elegidas y mueve las demás a una subcarpeta, para trabajar
        solo con las buenas. <strong>No borra nada</strong> y puedes deshacerlo.
      </p>
      <label className={styles.field}>
        Nombre de la subcarpeta
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </label>

      {preview ? (
        <ul className={styles.summary} aria-label="Qué va a pasar">
          <li>
            <strong>
              {plural(preview.kept, "foto elegida se queda", "fotos elegidas se quedan")}
            </strong>{" "}
            donde está.
          </li>
          <li>
            <strong>{plural(preview.to_move, "foto se mueve", "fotos se mueven")}</strong>
            {preview.sidecars > 0
              ? ` (con ${plural(preview.sidecars, "archivo .xmp", "archivos .xmp")})`
              : ""}{" "}
            a «{name.trim() || DEFAULT_NAME}».
          </li>
          {preview.kept_paired > 0 ? (
            <li>
              {plural(
                preview.kept_paired,
                "foto no elegida se queda",
                "fotos no elegidas se quedan",
              )}{" "}
              porque comparte nombre con una elegida (RAW + JPG).
            </li>
          ) : null}
          {preview.already > 0 ? (
            <li>
              {plural(preview.already, "foto ya estaba", "fotos ya estaban")} en esa subcarpeta.
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className={styles.actions}>
        <Button
          variant="primary"
          icon="folder"
          disabled={working || toMove === 0}
          onClick={() => void organize()}
        >
          {toMove === 0 ? "No hay nada que mover" : `Mover ${plural(toMove, "foto", "fotos")}`}
        </Button>
        {batchId ? (
          <Button disabled={working} onClick={() => void undo()}>
            Deshacer
          </Button>
        ) : null}
      </div>
      {done ? (
        <p role="status" className={styles.done}>
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
