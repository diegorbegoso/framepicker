import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "../../components/Panel.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
import type { Adjustments, LutInfo, SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";
import { hasGeometry, NEUTRAL, withGeometryOf } from "../../lib/engine.ts";
import { livePreview } from "../../lib/livePreview.ts";
import { previews } from "../../lib/previews.ts";
import { CropEditor } from "./crop/CropEditor.tsx";
import { GroupTab } from "./GroupTab.tsx";
import { PhotoTab } from "./PhotoTab.tsx";
import { buildScopes, type Scope } from "./scopes.ts";
import { useAutofix } from "./useAutofix.ts";
import type { Edits } from "./useEdits.ts";

const SAVE_DELAY_MS = 250;

type Props = {
  sessionId: string;
  /** Said when a correction could not be saved or calculated. */
  onError: (message: string | null) => void;
  photo: SelectedPhoto | undefined;
  bursts: SelectedBurst[];
  marked: ReadonlySet<string>;
  edits: Edits;
  luts: LutInfo[];
  onExport: (scope: Scope) => void;
};

/**
 * Corrections for the photo on screen, saved as you drag ("Esta foto"), and what can be done to
 * several photos at once ("Varias fotos"): copy settings, correct automatically, clear, export.
 */
export function CorrectionsPanel({
  sessionId,
  onError,
  photo,
  bursts,
  marked,
  edits,
  luts,
  onExport,
}: Props) {
  const photoId = photo?.id;
  const stored = edits.of(photoId);
  const [draft, setDraft] = useState<{ id: string; value: Adjustments } | null>(null);
  const [scope, setScope] = useState<Scope>("burst");
  const [tab, setTab] = useState<"photo" | "group">("photo");
  const [cropping, setCropping] = useState(false);
  const pending = useRef<{ id: string; value: Adjustments; timer: number } | null>(null);
  const save = useRef(edits.apply);
  save.current = edits.apply;

  const current = draft && draft.id === photoId ? draft.value : stored;
  const scopes = useMemo(() => buildScopes(bursts, photoId, marked), [bursts, photoId, marked]);

  // Only refs inside, so it never changes between renders.
  const flush = useCallback(() => {
    const waiting = pending.current;
    if (!waiting) return;
    window.clearTimeout(waiting.timer);
    pending.current = null;
    // Once saved (or put back, if saving failed) the stored value is the truth again, and the
    // live frame goes away as soon as the saved view has loaded behind it, so nothing flickers.
    void save
      .current([waiting.id], waiting.value)
      .then(() => previews.request(waiting.id, "view", 0).catch(() => undefined))
      .then(() => {
        setDraft((now) => (now?.value === waiting.value ? null : now));
        if (pending.current?.id !== waiting.id) livePreview.clear(waiting.id);
      });
  }, []);

  // A pending change is saved before another photo's change replaces it, and when leaving.
  useEffect(() => flush, [flush]);

  function change(patch: Partial<Adjustments>) {
    if (!photoId) return;
    const value = { ...current, ...patch };
    setDraft({ id: photoId, value });
    livePreview.update(photoId, value); // the viewer follows the slider while it moves
    if (pending.current && pending.current.id !== photoId) flush();
    if (pending.current) window.clearTimeout(pending.current.timer);
    const timer = window.setTimeout(flush, SAVE_DELAY_MS);
    pending.current = { id: photoId, value, timer };
  }

  /** The photo's settings on the others; each keeps its own crop and turn unless asked. */
  async function copyToGroup(withGeometry: boolean) {
    flush();
    const ids = scopes[scope];
    if (withGeometry) {
      await edits.apply(ids, current);
    } else if (ids.some((id) => hasGeometry(edits.of(id)))) {
      await edits.put(
        Object.fromEntries(ids.map((id) => [id, withGeometryOf(current, edits.of(id))])),
      );
    } else {
      await edits.apply(ids, withGeometryOf(current, NEUTRAL)); // none has a crop or turn to keep
    }
    setDraft(null);
    for (const id of ids) livePreview.clear(id);
  }

  async function restore(ids: string[]) {
    if (pending.current) {
      window.clearTimeout(pending.current.timer);
      pending.current = null;
    }
    await edits.reset(ids);
    setDraft(null);
    for (const id of ids) livePreview.clear(id);
  }

  const auto = useAutofix(sessionId, edits, onError);

  /** The program's suggestion for this photo, shown and saved like a move of the sliders. */
  async function autoCurrent() {
    if (!photoId) return;
    const found = await auto.suggestFor(photoId);
    if (!found) return;
    auto.remember([photoId]);
    const { lut_id: _lut, lut_strength: _strength, ...sliders } = found;
    change(sliders); // the LUT the photo already has stays as it was
  }

  const photoCount = scopes[scope].length;

  return (
    <Panel title="Correcciones" icon="sliders">
      <SegmentedControl
        label="Qué corregir"
        value={tab}
        onChange={setTab}
        options={[
          { value: "photo", label: "Esta foto" },
          { value: "group", label: "Varias fotos", count: photoCount },
        ]}
      />
      {tab === "photo" ? (
        <PhotoTab
          current={current}
          hasPhoto={Boolean(photo)}
          luts={luts}
          whiteBalance={auto.whiteBalance}
          onWhiteBalance={auto.setWhiteBalance}
          autoBusy={auto.running !== null}
          onAuto={() => void autoCurrent()}
          onChange={change}
          onCrop={() => setCropping(true)}
          onRestore={() => void restore(scopes.current)}
        />
      ) : (
        <GroupTab
          scope={scope}
          scopes={scopes}
          hasPhoto={Boolean(photo)}
          onScope={setScope}
          onCopy={(withGeometry) => void copyToGroup(withGeometry)}
          onClear={() => void restore(scopes[scope])}
          onExport={() => {
            flush();
            onExport(scope);
          }}
          whiteBalance={auto.whiteBalance}
          onWhiteBalance={auto.setWhiteBalance}
          running={auto.running}
          message={auto.message}
          canUndo={auto.canUndo}
          onRunAuto={() => {
            flush();
            void auto.runGroup(scopes[scope]);
          }}
          onCancelAuto={auto.cancel}
          onUndoAuto={() => void auto.undo()}
        />
      )}
      {cropping && photoId ? (
        <CropEditor
          photoId={photoId}
          current={current}
          onClose={() => setCropping(false)}
          onApply={(geometry) => {
            change(geometry);
            setCropping(false);
          }}
        />
      ) : null}
    </Panel>
  );
}
