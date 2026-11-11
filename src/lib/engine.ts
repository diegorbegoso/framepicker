/** Typed access to the engine. Screens use only this module; every reply is validated with zod. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { EngineError, engineRequest } from "./ipc.ts";

export { EngineError };

export const PATH_NOT_ALLOWED = -32010;
export const DEST_INSIDE_SOURCE = -32014;

const ScannedPhoto = z.object({
  id: z.string(),
  path: z.string(),
  format: z.enum(["jpg", "png", "raw"]),
  size_bytes: z.number(),
});
export const ScanResult = z.object({
  session_id: z.string(),
  photos: z.array(ScannedPhoto),
  skipped: z.number(),
});
export type ScanResult = z.infer<typeof ScanResult>;

const JobRef = z.object({ job_id: z.string() });
const CancelResult = z.object({ state: z.string() });

const BurstPhoto = z.object({
  id: z.string(),
  path: z.string(),
  format: z.string(),
  exif_time: z.string().nullable(),
});
export const BurstsResult = z.object({
  bursts: z.array(z.object({ id: z.string(), position: z.number(), photos: z.array(BurstPhoto) })),
});
export type BurstsResult = z.infer<typeof BurstsResult>;

const Scores = z.object({
  sharpness: z.number(),
  sharpness_norm: z.number(),
  exposure: z.number(),
  eyes_open: z.number().nullable(),
  combined: z.number(),
});
const SelectedPhoto = z.object({
  id: z.string(),
  path: z.string(),
  format: z.enum(["jpg", "png", "raw"]),
  scores: Scores,
  selected: z.boolean(),
  source: z.enum(["auto", "user"]),
  /** The minimums this photo misses; empty when it meets them all. */
  fails: z.array(z.enum(["sharpness", "exposure", "eyes"])),
});
const SelectedBurst = z.object({
  id: z.string(),
  position: z.number(),
  /** True when no photo of the burst meets the minimums, so none can be picked automatically. */
  no_pick: z.boolean(),
  photos: z.array(SelectedPhoto),
});
export const SelectResult = z.object({ bursts: z.array(SelectedBurst) });
export type SelectedPhoto = z.infer<typeof SelectedPhoto>;
export type SelectedBurst = z.infer<typeof SelectedBurst>;
export type SelectResult = z.infer<typeof SelectResult>;

const PickResult = z.object({
  burst_id: z.string(),
  photo_id: z.string(),
  selected: z.boolean(),
  source: z.literal("user"),
});
const PreviewResult = z.object({
  data_url: z.string().startsWith("data:image/jpeg;base64,"),
  width: z.number(),
  height: z.number(),
  source_width: z.number(),
  source_height: z.number(),
});
const ConfirmResult = z.object({ burst_id: z.string(), confirmed: z.number() });

/** A preview image and its sizes: `sourceWidth` is what a 100 % zoom shows. */
export type PreviewImage = {
  url: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

export const ExportOptions = z.object({
  format: z.enum(["original", "jpg", "png", "webp"]),
  /** 0 keeps the size. */
  long_edge: z.number().int(),
  quality: z.number().int(),
  /** Save each photo with the corrections and LUT it carries. */
  apply_edits: z.boolean(),
  name_pattern: z.string(),
});
export type ExportOptions = z.infer<typeof ExportOptions>;

/** The basic corrections of one photo. All zero and no LUT means "as shot". */
export const Adjustments = z.object({
  exposure: z.number(),
  contrast: z.number(),
  highlights: z.number(),
  shadows: z.number(),
  temperature: z.number(),
  tint: z.number(),
  saturation: z.number(),
  lut_id: z.string().nullable(),
  lut_strength: z.number(),
});
export type Adjustments = z.infer<typeof Adjustments>;

export const NEUTRAL: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  lut_id: null,
  lut_strength: 1,
};

const SLIDER_KEYS = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "temperature",
  "tint",
  "saturation",
] as const;

/** True when the corrections change nothing: every control at zero and no LUT. */
export function isNeutral(adj: Adjustments): boolean {
  return adj.lut_id === null && SLIDER_KEYS.every((key) => adj[key] === 0);
}

export const Weights = z.object({ sharpness: z.number(), exposure: z.number(), eyes: z.number() });
export type Weights = z.infer<typeof Weights>;
export const MinQuality = z.object({
  sharpness: z.number(),
  exposure: z.number(),
  eyes: z.number(),
});
export type MinQuality = z.infer<typeof MinQuality>;
export const Settings = z.object({
  theme: z.enum(["light", "dark"]),
  weights: Weights,
  per_burst: z.number().int(),
  min_quality: MinQuality,
  export_options: ExportOptions.optional(),
  time_gap_s: z.number(),
  hamming_max: z.number().int(),
});
export type Settings = z.infer<typeof Settings>;
const SettingSaved = z.object({ key: z.string(), value: z.unknown() });

export function scan(paths: string[], recursive = true) {
  return engineRequest("scan", { paths, recursive }, ScanResult);
}

export function analyze(sessionId: string, eyes = true) {
  return engineRequest("analyze", { session_id: sessionId, eyes }, JobRef);
}

export function cancel(jobId: string) {
  return engineRequest("cancel", { job_id: jobId }, CancelResult);
}

export function bursts(sessionId: string) {
  return engineRequest("bursts", { session_id: sessionId }, BurstsResult);
}

export function select(sessionId: string) {
  return engineRequest("select", { session_id: sessionId }, SelectResult);
}

export function setPick(burstId: string, photoId: string, selected: boolean) {
  return engineRequest("set_pick", { burst_id: burstId, photo_id: photoId, selected }, PickResult);
}

/** `develop` asks a RAW for a half-size demosaic instead of the camera's embedded preview. */
export async function preview(
  photoId: string,
  options: { maxPx?: number; develop?: boolean; edited?: boolean } = {},
): Promise<PreviewImage> {
  const { maxPx = 960, develop = false, edited = false } = options;
  const params = {
    photo_id: photoId,
    max_px: maxPx,
    develop,
    ...(edited ? { edited: true } : {}),
  };
  const reply = await engineRequest("preview", params, PreviewResult);
  return {
    url: reply.data_url,
    width: reply.width,
    height: reply.height,
    sourceWidth: reply.source_width,
    sourceHeight: reply.source_height,
  };
}

/** Marks a burst as reviewed, keeping its picks as they are. */
export function confirmBurst(burstId: string) {
  return engineRequest("confirm_burst", { burst_id: burstId }, ConfirmResult);
}

/**
 * Exports the chosen photos of a session to `dest` (a folder the shell already granted): copied
 * as they are, or re-encoded with the options.
 */
export function exportSelection(
  sessionId: string,
  dest: string,
  options?: ExportOptions,
  photoIds?: string[],
) {
  return engineRequest(
    "export",
    {
      session_id: sessionId,
      dest,
      ...(options ? { options } : {}),
      ...(photoIds ? { photo_ids: photoIds } : {}),
    },
    JobRef,
  );
}

export const LutInfo = z.object({ id: z.string(), name: z.string(), size: z.number() });
export type LutInfo = z.infer<typeof LutInfo>;

export async function listLuts(): Promise<LutInfo[]> {
  return (await engineRequest("luts_list", {}, z.object({ luts: z.array(LutInfo) }))).luts;
}

/** Copies a `.cube` file (picked with `pickLut`) into the program's own library. */
export function addLut(path: string) {
  return engineRequest("luts_add", { path }, LutInfo);
}

export function removeLut(lutId: string) {
  return engineRequest("luts_remove", { lut_id: lutId }, z.object({ lut_id: z.string() }));
}

/** Native dialog for a `.cube` file; the shell grants it to the engine. `null` when cancelled. */
export async function pickLut(): Promise<string | null> {
  return z
    .string()
    .nullable()
    .parse(await invoke("pick_lut"));
}

const OrganizePreview = z.object({
  to_move: z.number(),
  sidecars: z.number(),
  kept: z.number(),
  kept_paired: z.number(),
  already: z.number(),
  folders: z.array(z.string()),
});
export type OrganizePreview = z.infer<typeof OrganizePreview>;
const OrganizeResult = z.object({
  batch_id: z.string(),
  moved: z.number(),
  failed: z.number(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type OrganizeResult = z.infer<typeof OrganizeResult>;
const UndoResult = z.object({ batch_id: z.string(), restored: z.number(), skipped: z.number() });

/** What organising the folder would do. Changes nothing. */
export function organizePreview(sessionId: string, folderName: string) {
  return engineRequest(
    "organize_preview",
    { session_id: sessionId, folder_name: folderName },
    OrganizePreview,
  );
}

/** Moves the photos that were not chosen into a subfolder, next to where they are. */
export function organizeApply(sessionId: string, folderName: string) {
  return engineRequest(
    "organize_apply",
    { session_id: sessionId, folder_name: folderName },
    OrganizeResult,
  );
}

export function organizeUndo(batchId: string) {
  return engineRequest("organize_undo", { batch_id: batchId }, UndoResult);
}

const EditsResult = z.object({ edits: z.record(z.string(), Adjustments) });
const EditsSaved = z.object({ photo_ids: z.array(z.string()) });

/** The corrections of every edited photo of the session, by photo id. */
export async function getEdits(sessionId: string): Promise<Record<string, Adjustments>> {
  return (await engineRequest("edits_get", { session_id: sessionId }, EditsResult)).edits;
}

/** Stores the same corrections on those photos (all neutral clears them). */
export function setEdits(sessionId: string, photoIds: string[], adjustments: Adjustments) {
  return engineRequest(
    "edits_set",
    { session_id: sessionId, photo_ids: photoIds, adjustments },
    EditsSaved,
  );
}

export function resetEdits(sessionId: string, photoIds: string[]) {
  return engineRequest("edits_reset", { session_id: sessionId, photo_ids: photoIds }, EditsSaved);
}

export function getSettings() {
  return engineRequest("settings_get", {}, Settings);
}

export function setSetting(key: string, value: unknown) {
  return engineRequest("settings_set", { key, value }, SettingSaved);
}

/** Native folder dialog; the shell grants the folder to the engine. `null` when cancelled. */
export async function pickFolder(): Promise<string | null> {
  return z
    .string()
    .nullable()
    .parse(await invoke("pick_folder"));
}

/** Native file dialog; the shell grants their folders to the engine. `null` when cancelled. */
export async function pickFiles(): Promise<string[] | null> {
  return z
    .array(z.string())
    .nullable()
    .parse(await invoke("pick_files"));
}

const ProgressEvent = z.object({
  method: z.literal("progress"),
  params: z.object({ job_id: z.string(), kind: z.string(), done: z.number(), total: z.number() }),
});
const JobDoneEvent = z.object({
  method: z.literal("job_done"),
  params: z.object({
    job_id: z.string(),
    kind: z.string(),
    state: z.enum(["running", "done", "cancelled", "failed"]),
    failed: z.number(),
    // analyze reports computed and cached; export reports copied.
    computed: z.number().optional(),
    cached: z.number().optional(),
    copied: z.number().optional(),
  }),
});
export const EngineEvent = z.discriminatedUnion("method", [ProgressEvent, JobDoneEvent]);
export type EngineEvent = z.infer<typeof EngineEvent>;

/** Subscribes to engine notifications; malformed or unknown ones are dropped. Returns unlisten. */
export async function onEngineEvent(callback: (event: EngineEvent) => void): Promise<() => void> {
  return listen("engine-event", (event) => {
    const parsed = EngineEvent.safeParse(event.payload);
    if (parsed.success) callback(parsed.data);
  });
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
