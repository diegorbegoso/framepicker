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
  /** True when these photos were picked before: the session, with its progress, came back. */
  resumed: z.boolean().optional(),
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
export const SelectResult = z.object({
  bursts: z.array(SelectedBurst),
  /** The burst the person was looking at when they left, if it is known. */
  last_burst_id: z.string().nullable().optional(),
  /** The session's name. */
  label: z.string().optional(),
});
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

/** Where a curve passes: points [input, output] from 0 to 1, left to right. Fewer than two: none. */
export const CurvePoints = z.array(z.tuple([z.number(), z.number()]));
export const CURVE_CHANNELS = ["master", "r", "g", "b"] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];
export const Curves = z.object({
  master: CurvePoints.default([]),
  r: CurvePoints.default([]),
  g: CurvePoints.default([]),
  b: CurvePoints.default([]),
});
export type Curves = z.infer<typeof Curves>;

export const HSL_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
] as const;
export type HslColor = (typeof HSL_COLORS)[number];
const Triple = z.tuple([z.number(), z.number(), z.number()]);
/** Hue, saturation and brightness moves (-1 to 1) for each colour range. */
export const Hsl = z.object(
  Object.fromEntries(HSL_COLORS.map((color) => [color, Triple.default([0, 0, 0])])) as Record<
    HslColor,
    z.ZodDefault<typeof Triple>
  >,
);
export type Hsl = z.infer<typeof Hsl>;

export const neutralCurves = (): Curves => ({ master: [], r: [], g: [], b: [] });
export const neutralHsl = (): Hsl =>
  Object.fromEntries(HSL_COLORS.map((color) => [color, [0, 0, 0]])) as Hsl;

/** The corrections of one photo. All zero, no LUT and no crop or turn means "as shot". */
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
  whites: z.number().default(0),
  blacks: z.number().default(0),
  vibrance: z.number().default(0),
  clarity: z.number().default(0),
  sharpen: z.number().default(0),
  vignette: z.number().default(0),
  curves: Curves.default({ master: [], r: [], g: [], b: [] }),
  hsl: Hsl.default(neutralHsl()),
  /** Quarter turns clockwise, 0 to 3. */
  rotate: z.number().default(0),
  flip: z.boolean().default(false),
  /** Degrees to straighten, -45 to 45; positive turns the picture clockwise. */
  angle: z.number().default(0),
  /** [x0, y0, x1, y1] on the straightened canvas, 0 to 1; null: the whole picture. */
  crop: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().default(null),
  /** The proportion the crop was drawn with ("3:2", "libre"...), only to reopen the editor. */
  aspect: z.string().nullable().default(null),
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
  whites: 0,
  blacks: 0,
  vibrance: 0,
  clarity: 0,
  sharpen: 0,
  vignette: 0,
  curves: neutralCurves(),
  hsl: neutralHsl(),
  rotate: 0,
  flip: false,
  angle: 0,
  crop: null,
  aspect: null,
};

/** Every number slider (exposure in stops, the rest from -1 to 1; sharpen from 0 to 1). */
export const SLIDER_KEYS = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "vibrance",
  "saturation",
  "clarity",
  "sharpen",
  "vignette",
] as const;
export type SliderKey = (typeof SLIDER_KEYS)[number];

const curveIsStraight = (points: Curves[CurveChannel]) =>
  points.length < 2 || points.every(([x, y]) => Math.abs(x - y) < 1e-6);

export const hasCurves = (adj: Adjustments) =>
  !CURVE_CHANNELS.every((channel) => curveIsStraight(adj.curves[channel]));
export const hasMixer = (adj: Adjustments) =>
  HSL_COLORS.some((color) => adj.hsl[color].some((n) => n !== 0));
/** A turn, a mirror, a straightening or a crop. The proportion alone changes nothing. */
export const hasGeometry = (adj: Adjustments) =>
  adj.rotate % 4 !== 0 || adj.flip || adj.angle !== 0 || adj.crop !== null;

/** True when the corrections change nothing at all. */
export function isNeutral(adj: Adjustments): boolean {
  return (
    adj.lut_id === null &&
    SLIDER_KEYS.every((key) => adj[key] === 0) &&
    !hasCurves(adj) &&
    !hasMixer(adj) &&
    !hasGeometry(adj)
  );
}

/** The same corrections but with the geometry (turn, mirror, angle, crop) of another set. */
export function withGeometryOf(adj: Adjustments, geometry: Adjustments): Adjustments {
  const { rotate, flip, angle, crop, aspect } = geometry;
  return { ...adj, rotate, flip, angle, crop, aspect };
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
  options: {
    maxPx?: number;
    develop?: boolean;
    /** Show the corrections saved for the photo. */
    edited?: boolean;
    /** Show these corrections instead, without saving them (a slider being dragged). */
    adjustments?: Adjustments;
  } = {},
): Promise<PreviewImage> {
  const { maxPx = 960, develop = false, edited = false, adjustments } = options;
  const params = {
    photo_id: photoId,
    max_px: maxPx,
    develop,
    ...(edited ? { edited: true } : {}),
    ...(adjustments ? { adjustments } : {}),
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

export const LutInfo = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  /** The sub-list it belongs to (the folder it came from), or none. */
  group: z.string().nullable().default(null),
  favorite: z.boolean().default(false),
});
export type LutInfo = z.infer<typeof LutInfo>;

export async function listLuts(): Promise<LutInfo[]> {
  return (await engineRequest("luts_list", {}, z.object({ luts: z.array(LutInfo) }))).luts;
}

export const LutsAdded = z.object({
  added: z.array(LutInfo),
  /** Files whose look was already in the library. */
  duplicates: z.array(
    z.object({ path: z.string(), name: z.string(), renamed: z.boolean().default(false) }),
  ),
  failed: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type LutsAdded = z.infer<typeof LutsAdded>;

/** Copies several `.cube` files (picked with `pickLuts`) into the program's own library. */
export function addLuts(paths: string[]) {
  return engineRequest("luts_add_many", { paths }, LutsAdded);
}

/** Copies every `.cube` file of a folder (picked with `pickFolder`). */
export function addLutFolder(path: string) {
  return engineRequest("luts_add_folder", { path }, LutsAdded);
}

export type LutChanges = { name?: string; group?: string | null; favorite?: boolean };

/** Renames a LUT, moves it to another group (null: none) or marks it as a favourite. */
export async function updateLut(lutId: string, changes: LutChanges): Promise<LutInfo> {
  const reply = await engineRequest(
    "luts_update",
    { lut_id: lutId, ...changes },
    z.object({ lut: LutInfo }),
  );
  return reply.lut;
}

export function renameLutGroup(from: string, to: string) {
  return engineRequest("luts_group_rename", { from, to }, z.object({ moved: z.number() }));
}

export function removeLutGroup(group: string) {
  return engineRequest("luts_group_remove", { group }, z.object({ removed: z.number() }));
}

export function removeLut(lutId: string) {
  return engineRequest("luts_remove", { lut_id: lutId }, z.object({ lut_id: z.string() }));
}

/** Native dialog for `.cube` files, several at once; the shell grants them. `null` when cancelled. */
export async function pickLuts(): Promise<string[] | null> {
  return z
    .array(z.string())
    .nullable()
    .parse(await invoke("pick_luts"));
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

/** Gives each photo its own corrections (or none, with `null`): how an undo puts many back. */
export function putEdits(sessionId: string, entries: Record<string, Adjustments | null>) {
  return engineRequest("edits_put", { session_id: sessionId, entries }, EditsSaved);
}

/** The corrections the program suggests for one photo, without saving them. */
export async function autofixSuggest(photoId: string, whiteBalance: boolean): Promise<Adjustments> {
  const reply = await engineRequest(
    "autofix_suggest",
    { photo_id: photoId, white_balance: whiteBalance },
    z.object({ adjustments: Adjustments }),
  );
  return reply.adjustments;
}

/** Corrects a group in the background, one correction per burst; progress arrives as events. */
export function autofixRun(sessionId: string, photoIds: string[], whiteBalance: boolean) {
  return engineRequest(
    "autofix_run",
    { session_id: sessionId, photo_ids: photoIds, white_balance: whiteBalance },
    JobRef,
  );
}

export function resetEdits(sessionId: string, photoIds: string[]) {
  return engineRequest("edits_reset", { session_id: sessionId, photo_ids: photoIds }, EditsSaved);
}

export const SessionSummary = z.object({
  id: z.string(),
  label: z.string(),
  folder: z.string(),
  photos: z.number(),
  bursts: z.number(),
  picked: z.number(),
  reviewed: z.number(),
  edited: z.number(),
  updated_at: z.string(),
  last_burst_id: z.string().nullable(),
  /** False when the photos are no longer where they were. */
  available: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** The sessions worked on before, latest first. */
export async function sessionsList(): Promise<SessionSummary[]> {
  const reply = await engineRequest(
    "sessions_list",
    {},
    z.object({ sessions: z.array(SessionSummary) }),
  );
  return reply.sessions;
}

/** Remembers which burst the person is on, and that the session was just used. */
export function sessionTouch(sessionId: string, burstId?: string) {
  return engineRequest(
    "session_touch",
    { session_id: sessionId, ...(burstId ? { burst_id: burstId } : {}) },
    z.object({ session_id: z.string() }),
  );
}

/** Gives the session a name of the person's choosing. */
export async function sessionRename(sessionId: string, label: string): Promise<string> {
  const reply = await engineRequest(
    "session_rename",
    { session_id: sessionId, label },
    z.object({ session_id: z.string(), label: z.string() }),
  );
  return reply.label;
}

/** Forgets a session (its choices and corrections). The photos are not touched. */
export function sessionForget(sessionId: string) {
  return engineRequest(
    "session_forget",
    { session_id: sessionId },
    z.object({ session_id: z.string() }),
  );
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
    // autofix reports how many photos it corrected.
    fixed: z.number().optional(),
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

/** The angle that would level a photo from its straight lines, or none when it has no clear ones. */
export async function straightenSuggest(
  photoId: string,
): Promise<{ found: boolean; angle: number }> {
  return engineRequest(
    "straighten_suggest",
    { photo_id: photoId },
    z.object({ found: z.boolean(), angle: z.number() }),
  );
}
