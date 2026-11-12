import type { LutsAdded } from "./engine.ts";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** What loading a batch of LUTs came to, in a sentence or two: how many went in, repeated, broken. */
export function summarizeLuts(result: LutsAdded): string {
  const parts: string[] = [];
  const { added, duplicates, failed } = result;
  if (added.length > 0) {
    parts.push(
      added.length === 1 ? `Se cargó ${added[0]?.name}.` : `Se cargaron ${added.length} LUT.`,
    );
  }
  if (duplicates.length > 0) {
    parts.push(duplicates.length === 1 ? "1 ya estaba." : `${duplicates.length} ya estaban.`);
    const renamed = duplicates.filter((d) => d.renamed).length;
    if (renamed > 0) {
      parts.push(renamed === 1 ? "1 se renombró." : `${renamed} se renombraron.`);
    }
  }
  if (failed.length > 0) {
    const names = failed.map((f) => fileName(f.path));
    const shown = names.slice(0, 3).join(", ");
    const more = names.length > 3 ? ` y ${names.length - 3} más` : "";
    const lead = failed.length === 1 ? "1 no era válido" : `${failed.length} no eran válidos`;
    parts.push(`${lead}: ${shown}${more}.`);
  }
  if (parts.length === 0) return "No había LUT nuevos.";
  if (added.length > 0) parts.push("Quedan guardados en el programa.");
  return parts.join(" ");
}
