import { useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
import type { ExportOptions, LutInfo } from "../../lib/engine.ts";
import * as engine from "../../lib/engine.ts";
import styles from "./ExportDialog.module.css";
import { useExportJob } from "./useExportJob.ts";

type Props = { sessionId: string; selectedCount: number; onClose: () => void };

const DEFAULTS: ExportOptions = {
  format: "original",
  long_edge: 0,
  quality: 92,
  lut_id: null,
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

/** Exporting the chosen photos: as they are, or in another format, size, quality and colour. */
export function ExportDialog({ sessionId, selectedCount, onClose }: Props) {
  const [options, setOptions] = useState<ExportOptions>(DEFAULTS);
  const [luts, setLuts] = useState<LutInfo[]>([]);
  const job = useExportJob(sessionId, selectedCount);

  useEffect(() => {
    // Each answer is optional: the dialog works with the defaults and without LUTs.
    void engine
      .getSettings()
      .then((stored) => {
        if (stored?.export_options) setOptions(stored.export_options);
      })
      .catch(() => undefined);
    void engine
      .listLuts()
      .then(setLuts)
      .catch(() => undefined);
  }, []);

  const change = (patch: Partial<ExportOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const copy = options.format === "original" && options.long_edge === 0 && options.lut_id === null;
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
    await job.start(clean, copy);
  }

  return (
    <Dialog title="Exportar fotos elegidas" onClose={onClose}>
      <p className={styles.count}>
        {selectedCount === 0
          ? "Elige al menos una foto para exportar."
          : `${selectedCount} ${selectedCount === 1 ? "foto elegida" : "fotos elegidas"}`}
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
          ? "Copia los archivos tal cual, con su .xmp si lo tienen."
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

      <label className={styles.field}>
        Aplicar LUT
        <select
          value={options.lut_id ?? ""}
          onChange={(event) => change({ lut_id: event.target.value || null })}
        >
          <option value="">Sin LUT</option>
          {luts.map((lut) => (
            <option key={lut.id} value={lut.id}>
              {lut.name}
            </option>
          ))}
        </select>
      </label>

      {copy ? null : (
        <label className={styles.field}>
          Nombre del archivo
          <input
            type="text"
            value={options.name_pattern}
            onChange={(event) => change({ name_pattern: event.target.value })}
          />
        </label>
      )}
      {copy ? null : (
        <p className={styles.help}>
          Usa {"{name}"} para el nombre original y {"{n}"} para un número (001, 002…).
        </p>
      )}

      <Button
        variant="primary"
        icon="download"
        disabled={selectedCount === 0 || busy}
        onClick={() => void run()}
      >
        Elegir carpeta y exportar
      </Button>
      {job.copying ? (
        <p
          className={styles.help}
        >{`${copy ? "Copiando" : "Exportando"} ${job.copying.done} de ${job.copying.total}`}</p>
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
