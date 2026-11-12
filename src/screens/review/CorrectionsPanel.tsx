import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Panel } from "../../components/Panel.tsx";
import type { Adjustments, LutInfo, SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";
import { isNeutral } from "../../lib/engine.ts";
import { livePreview } from "../../lib/livePreview.ts";
import { previews } from "../../lib/previews.ts";
import { AutoGroup, AutoTop } from "./AutoCorrect.tsx";
import styles from "./CorrectionsPanel.module.css";
import { ManualControls } from "./ManualControls.tsx";
import { buildScopes, SCOPE_ORDER, type Scope, scopeText } from "./scopes.ts";
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
 * Basic corrections for the photo on screen, saved as you drag. The same corrections can be copied
 * to a group of photos, and any group can be exported from here.
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

  async function copyToGroup() {
    flush();
    await edits.apply(scopes[scope], current);
    setDraft(null);
    for (const id of scopes[scope]) livePreview.clear(id);
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

  return (
    <Panel title="Corrección básica" icon="sliders">
      <AutoTop
        whiteBalance={auto.whiteBalance}
        onWhiteBalance={auto.setWhiteBalance}
        disabled={!photo}
        busy={auto.running !== null}
        onAuto={() => void autoCurrent()}
      />
      <ManualControls current={current} disabled={!photo} luts={luts} onChange={change} />

      <Button
        size="sm"
        disabled={!photo || isNeutral(current)}
        onClick={() => void restore(scopes.current)}
      >
        Restablecer esta foto
      </Button>

      <div className={styles.group}>
        <label className={styles.field}>
          Aplicar a
          <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
            {SCOPE_ORDER.map((id) => (
              <option key={id} value={id} disabled={scopes[id].length === 0}>
                {scopeText(id, scopes)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.buttons}>
          <Button
            variant="primary"
            size="sm"
            disabled={!photo || scopes[scope].length === 0}
            onClick={() => void copyToGroup()}
          >
            Aplicar al grupo
          </Button>
          <Button
            size="sm"
            disabled={scopes[scope].length === 0}
            onClick={() => void restore(scopes[scope])}
          >
            Quitar correcciones
          </Button>
        </div>
        <AutoGroup
          count={scopes[scope].length}
          running={auto.running}
          message={auto.message}
          canUndo={auto.canUndo}
          onRun={() => {
            flush();
            void auto.runGroup(scopes[scope]);
          }}
          onCancel={auto.cancel}
          onUndo={() => void auto.undo()}
        />
        <Button
          icon="download"
          disabled={scopes[scope].length === 0}
          onClick={() => {
            flush();
            onExport(scope);
          }}
        >
          Exportar…
        </Button>
      </div>
    </Panel>
  );
}
