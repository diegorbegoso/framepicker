import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { IconButton } from "../../components/IconButton.tsx";
import * as engine from "../../lib/engine.ts";
import { getViewLut, setViewLut } from "../../lib/previews.ts";
import styles from "./LutDialog.module.css";

type Props = { onClose: () => void };

const INVALID = "Ese archivo no es un LUT 3D .cube válido.";

/** The LUTs kept in the program, and which one the photos are shown through. */
export function LutDialog({ onClose }: Props) {
  const [luts, setLuts] = useState<engine.LutInfo[]>([]);
  const [viewing, setViewing] = useState<string | null>(getViewLut());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    try {
      setLuts(await engine.listLuts());
    } catch {
      setError("No se pudo leer la biblioteca de LUT.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function choose(lutId: string | null) {
    try {
      await engine.setSetting("view_lut", lutId);
      setViewLut(lutId);
      setViewing(lutId);
      setError(null);
    } catch {
      setError("No se pudo cambiar el LUT de la vista.");
    }
  }

  async function load() {
    setError(null);
    try {
      const path = await engine.pickLut();
      if (path === null) return;
      const added = await engine.addLut(path);
      await refresh();
      setStatus(`Se cargó ${added.name}. Queda guardado en el programa.`);
    } catch (failure) {
      const invalid = failure instanceof engine.EngineError && failure.code === -32602;
      setError(invalid ? INVALID : "No se pudo cargar el LUT.");
    }
  }

  async function remove(lut: engine.LutInfo) {
    try {
      if (viewing === lut.id) await choose(null);
      await engine.removeLut(lut.id);
      await refresh();
      setStatus(`Se quitó ${lut.name}.`);
    } catch {
      setError("No se pudo quitar el LUT.");
    }
  }

  return (
    <Dialog title="Biblioteca de LUT" onClose={onClose}>
      <p className={styles.help}>
        Un LUT cambia el color de las fotos, como un filtro. Se carga una sola vez y queda guardado
        en el programa. Aquí eliges con cuál ver las fotos; al exportar eliges si se aplica.
      </p>
      <Button variant="primary" icon="folder" onClick={() => void load()}>
        Cargar LUT (.cube)…
      </Button>
      <fieldset className={styles.list}>
        <legend className={styles.legend}>Ver las fotos con</legend>
        <label className={styles.row}>
          <input
            type="radio"
            name="view-lut"
            checked={viewing === null}
            onChange={() => void choose(null)}
          />
          <span className={styles.name}>Ninguno (como salieron de la cámara)</span>
        </label>
        {luts.map((lut) => (
          <div key={lut.id} className={styles.row}>
            <label className={styles.pick}>
              <input
                type="radio"
                name="view-lut"
                checked={viewing === lut.id}
                onChange={() => void choose(lut.id)}
              />
              <span className={styles.name}>{lut.name}</span>
              <span className={styles.size}>
                {lut.size}×{lut.size}×{lut.size}
              </span>
            </label>
            <IconButton icon="x" label={`Quitar ${lut.name}`} onClick={() => void remove(lut)} />
          </div>
        ))}
        {luts.length === 0 ? <p className={styles.empty}>Aún no has cargado ningún LUT.</p> : null}
      </fieldset>
      <p role="status" className={styles.status}>
        {status}
      </p>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
