import { useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
import type { ExportOptions } from "../../lib/engine.ts";
import * as engine from "../../lib/engine.ts";
import { SCOPE_ORDER, type Scope, type ScopeIds, scopeText } from "../review/scopes.ts";
import styles from "./ExportDialog.module.css";
import { useExportJob } from "./useExportJob.ts";

type Props = {
  sessionId: string;
  /** The photos behind each choice of "what to export". */
  scopes: ScopeIds;
  initialScope: Scope;
  onClose: () => void;
};

const DEFAULTS: ExportOptions = {
  format: "original",
  long_edge: 0,
  quality: 92,
  apply_edits: true,
  name_pattern: "{name}",
};

const SIZES: [number, string][] = [
  [0, "Tamaño original"],
  [1080, "1080 px"],
  [2048, "2048 px"],
  [3000, "3000 px"],
  [4000, "4000 px"],
  [6000, "6000 px"],
];

/** Exporting photos: as they are, or in another format, size and quality, with their corrections. */
export function ExportDialog({ sessionId, scopes, initialScope, onClose }: Props) {
  const [options, setOptions] = useState<ExportOptions>(DEFAULTS);
  const [scope, setScope] = useState<Scope>(initialScope);
  const ids = scopes[scope];
  const job = useExportJob(sessionId, ids.length);

  useEffect(() => {
    // Remembered options are optional: the dialog works with the defaults.
    void engine
      .getSettings()
      .then((stored) => {
        if (stored?.export_options) setOptions(stored.export_options);
      })
      .catch(() => undefined);
  }, []);

  const change = (patch: Partial<ExportOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const copy = options.format === "original" && options.long_edge === 0;
  const hasQuality = options.format === "jpg" || options.format === "webp" || !copy;
  const busy = job.copying !== null;
  const pattern = options.name_pattern.trim();

  async function run() {
    const clean = { ...options, name_pattern: pattern || "{name}" };
    try {
      await engine.setSetting("export_options", clean);
    } catch {
      // Not remembering the choices must not stop the export.
    }
    // The chosen photos are what the engine exports when it is not told which ones.
    await job.start(clean, copy, scope === "picked" ? undefined : ids);
  }

  return (
    <Dialog title="Exportar fotos" onClose={onClose}>
      <label className={styles.field}>
        Qué exportar
        <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
          {SCOPE_ORDER.map((id) => (
            <option key={id} value={id} disabled={scopes[id].length === 0 && id !== scope}>
              {scopeText(id, scopes)}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.count}>
        {ids.length === 0
          ? "No hay fotos para exportar con esta opción."
          : `${ids.length} ${ids.length === 1 ? "foto" : "fotos"}`}
      </p>

      <SegmentedControl
        label="Formato"
        value={options.format}
        options={[
          { value: "original", label: "Originales" },
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
          { value: "webp", label: "WebP" },
        ]}
        onChange={(format) => change({ format })}
      />
      <p className={styles.help}>
        {copy
          ? "Copia los archivos tal cual, con su .xmp si lo tienen. Las fotos con correcciones se guardan de nuevo."
          : "Vuelve a guardar cada foto. Los RAW se revelan y salen como JPG."}
      </p>

      <label className={styles.field}>
        Lado mayor
        <select
          value={options.long_edge}
          onChange={(event) => change({ long_edge: Number(event.target.value) })}
        >
          {SIZES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {hasQuality && options.format !== "png" ? (
        <label className={styles.slider}>
          <span className={styles.row}>
            Calidad
            <output>{options.quality}</output>
          </span>
          <input
            type="range"
            aria-label="Calidad"
            min={40}
            max={100}
            step={1}
            value={options.quality}
            onChange={(event) => change({ quality: Number(event.target.value) })}
          />
        </label>
      ) : null}

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={options.apply_edits}
          onChange={(event) => change({ apply_edits: event.target.checked })}
        />
        Aplicar las correcciones y el LUT de cada foto
      </label>

      {copy && options.apply_edits ? null : (
        <label className={styles.field}>
          Nombre del archivo
          <input
            type="text"
            value={options.name_pattern}
            onChange={(event) => change({ name_pattern: event.target.value })}
          />
        </label>
      )}
      {copy && options.apply_edits ? null : (
        <p className={styles.help}>
          Usa {"{name}"} para el nombre original y {"{n}"} para un número (001, 002…).
        </p>
      )}

      <Button
        variant="primary"
        icon="download"
        disabled={ids.length === 0 || busy}
        onClick={() => void run()}
      >
        Elegir carpeta y exportar
      </Button>
      {job.copying ? (
        <p className={styles.help}>
          {`${copy ? "Copiando" : "Exportando"} ${job.copying.done} de ${job.copying.total}`}
        </p>
      ) : null}
      {job.success ? (
        <p role="status" className={styles.success}>
          {job.success}
        </p>
      ) : null}
      {job.error ? (
        <p role="alert" className={styles.error}>
          {job.error}
        </p>
      ) : null}
    </Dialog>
  );
}
