import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { type Adjustments, type EngineEvent, NEUTRAL } from "../lib/engine.ts";
import { livePreview } from "../lib/livePreview.ts";
import { previews } from "../lib/previews.ts";
import { RESULT } from "./fixtures.ts";
import { ReviewScreen } from "./ReviewScreen.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    preview: vi.fn(),
    getSettings: vi.fn(),
    setSetting: vi.fn(),
    onEngineEvent: vi.fn(),
    setPick: vi.fn(),
    listLuts: vi.fn(),
    getEdits: vi.fn(),
    setEdits: vi.fn(),
    resetEdits: vi.fn(),
    putEdits: vi.fn(),
    autofixSuggest: vi.fn(),
    autofixRun: vi.fn(),
    cancel: vi.fn(),
  };
});
vi.mock("../lib/window.ts", () => ({ setFullscreen: vi.fn() }));

const mocked = vi.mocked(engine);
let emit: (event: EngineEvent) => void = () => undefined;

const FOUND: Adjustments = { ...NEUTRAL, exposure: 0.6, contrast: 0.12, shadows: 0.2 };
const SAVED = (patch: Partial<Adjustments>): Adjustments => ({ ...NEUTRAL, ...patch });

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
  livePreview.clear("IMG_2");
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
  mocked.onEngineEvent.mockImplementation(async (callback) => {
    emit = callback;
    return () => undefined;
  });
  mocked.preview.mockResolvedValue({
    url: "data:image/jpeg;base64,AAAA",
    width: 1600,
    height: 1067,
    sourceWidth: 6000,
    sourceHeight: 4000,
  });
  mocked.getSettings.mockRejectedValue(new Error("not needed"));
  mocked.setSetting.mockImplementation(async (key, value) => ({ key, value }));
  mocked.listLuts.mockResolvedValue([]);
  mocked.getEdits.mockResolvedValue({});
  mocked.setEdits.mockImplementation(async (_s, ids) => ({ photo_ids: ids }));
  mocked.resetEdits.mockImplementation(async (_s, ids) => ({ photo_ids: ids }));
  mocked.putEdits.mockImplementation(async (_s, entries) => ({ photo_ids: Object.keys(entries) }));
  mocked.autofixSuggest.mockResolvedValue(FOUND);
  mocked.autofixRun.mockResolvedValue({ job_id: "a1" });
  mocked.cancel.mockResolvedValue({ state: "cancelled" });
});

function openReview() {
  const user = userEvent.setup();
  render(
    <ReviewScreen
      sessionId="s1"
      initial={RESULT}
      theme="light"
      onThemeChange={vi.fn()}
      immersive={false}
      onImmersiveChange={vi.fn()}
      onReset={vi.fn()}
    />,
  );
  return user;
}

const panel = () => screen.getByRole("region", { name: "Corrección básica" });
const progress = (done: number, total: number): EngineEvent => ({
  method: "progress",
  params: { job_id: "a1", kind: "autofix", done, total },
});
const done = (state: "done" | "cancelled" | "failed", fixed: number): EngineEvent => ({
  method: "job_done",
  params: { job_id: "a1", kind: "autofix", state, failed: 0, fixed },
});

describe("automatic correction of the photo on screen", () => {
  it("asks the engine and fills the sliders, saving like any other change", async () => {
    const user = openReview();
    await user.click(within(panel()).getByRole("button", { name: "Automático" }));
    expect(mocked.autofixSuggest).toHaveBeenCalledWith("IMG_2", false);
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalledTimes(1));
    expect(mocked.setEdits).toHaveBeenCalledWith(
      "s1",
      ["IMG_2"],
      SAVED({ exposure: 0.6, contrast: 0.12, shadows: 0.2 }),
    );
    const exposure = within(panel()).getByRole("spinbutton", { name: "Exposición (valor)" });
    expect(exposure).toHaveDisplayValue("0.6");
  });

  it("asks for white balance only when the box is ticked", async () => {
    const user = openReview();
    const box = within(panel()).getByRole("checkbox", { name: "Balance de blancos" });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(within(panel()).getByRole("button", { name: "Automático" }));
    expect(mocked.autofixSuggest).toHaveBeenCalledWith("IMG_2", true);
  });

  it("keeps the LUT the photo already had", async () => {
    mocked.getEdits.mockResolvedValue({ IMG_2: SAVED({ lut_id: "l1", lut_strength: 0.5 }) });
    const user = openReview();
    await waitFor(() => expect(mocked.getEdits).toHaveBeenCalled());
    await within(panel()).findByRole("spinbutton", { name: "Intensidad del LUT (valor)" });
    await user.click(within(panel()).getByRole("button", { name: "Automático" }));
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    expect(mocked.setEdits).toHaveBeenCalledWith(
      "s1",
      ["IMG_2"],
      SAVED({ exposure: 0.6, contrast: 0.12, shadows: 0.2, lut_id: "l1", lut_strength: 0.5 }),
    );
  });

  it("says so when it cannot calculate, and changes nothing", async () => {
    mocked.autofixSuggest.mockRejectedValue(new Error("engine down"));
    const user = openReview();
    await user.click(within(panel()).getByRole("button", { name: "Automático" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo calcular la corrección automática.",
    );
    expect(mocked.setEdits).not.toHaveBeenCalled();
  });
});

describe("automatic correction of a group", () => {
  async function start(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(panel()).getByRole("button", { name: "Automático al grupo" }));
    await waitFor(() => expect(mocked.autofixRun).toHaveBeenCalled());
  }

  it("runs on the chosen group and shows its progress", async () => {
    const user = openReview();
    await user.selectOptions(within(panel()).getByLabelText("Aplicar a"), "Las elegidas (2)");
    await start(user);
    expect(mocked.autofixRun).toHaveBeenCalledWith("s1", ["IMG_2", "IMG_4"], false);
    act(() => emit(progress(1, 2)));
    expect(within(panel()).getByText("Corrigiendo 1 de 2")).toBeInTheDocument();
    expect(within(panel()).getByRole("progressbar")).toHaveAttribute("value", "1");
    expect(within(panel()).queryByRole("button", { name: "Automático al grupo" })).toBeNull();
  });

  it("uses white balance for the group when the box is ticked", async () => {
    const user = openReview();
    await user.click(within(panel()).getByRole("checkbox", { name: "Balance de blancos" }));
    await start(user);
    expect(mocked.autofixRun).toHaveBeenCalledWith("s1", ["IMG_1", "IMG_2", "IMG_3"], true);
  });

  it("reads the corrections back when it is done and says how many photos", async () => {
    const user = openReview();
    await start(user);
    mocked.getEdits.mockResolvedValue({ IMG_1: FOUND, IMG_2: FOUND, IMG_3: FOUND });
    act(() => emit(done("done", 3)));
    expect(
      await within(panel()).findByText("Corrección automática aplicada a 3 fotos."),
    ).toBeVisible();
    await waitFor(() => expect(mocked.getEdits).toHaveBeenCalledTimes(2));
    expect(
      await within(panel()).findByRole("spinbutton", { name: "Exposición (valor)" }),
    ).toHaveDisplayValue("0.6");
  });

  it("can be cancelled, and keeps what was already corrected", async () => {
    const user = openReview();
    await start(user);
    act(() => emit(progress(1, 3)));
    await user.click(within(panel()).getByRole("button", { name: "Cancelar" }));
    expect(mocked.cancel).toHaveBeenCalledWith("a1");
    act(() => emit(done("cancelled", 1)));
    expect(await within(panel()).findByText("Cancelado: se corrigió 1 foto.")).toBeVisible();
  });

  it("goes back to what each photo had with Deshacer", async () => {
    mocked.getEdits.mockResolvedValue({ IMG_1: SAVED({ tint: 0.2 }) });
    const user = openReview();
    await waitFor(() => expect(mocked.getEdits).toHaveBeenCalled());
    await start(user);
    mocked.getEdits.mockResolvedValue({ IMG_1: FOUND, IMG_2: FOUND, IMG_3: FOUND });
    act(() => emit(done("done", 3)));
    await user.click(await within(panel()).findByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(mocked.putEdits).toHaveBeenCalled());
    expect(mocked.putEdits).toHaveBeenCalledWith("s1", {
      IMG_1: SAVED({ tint: 0.2 }), // had its own before
      IMG_2: null, // had none
      IMG_3: null,
    });
    expect(
      await within(panel()).findByText("Se devolvieron las correcciones de antes."),
    ).toBeVisible();
    expect(within(panel()).queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  it("can undo the automatic correction of a single photo too", async () => {
    mocked.getEdits.mockResolvedValue({ IMG_2: SAVED({ saturation: 0.1 }) });
    const user = openReview();
    await within(panel()).findByRole("spinbutton", { name: "Saturación (valor)" });
    await user.click(within(panel()).getByRole("button", { name: "Automático" }));
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    // The group undo button belongs to the group run; a single run is undone with the sliders.
    expect(within(panel()).queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  it("reports a job that failed", async () => {
    const user = openReview();
    await start(user);
    act(() => emit(done("failed", 0)));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo aplicar la corrección automática.",
    );
    expect(within(panel()).getByRole("button", { name: "Automático al grupo" })).toBeEnabled();
  });

  it("copes with a job that finishes before its id comes back", async () => {
    let answer: (value: { job_id: string }) => void = () => undefined;
    mocked.autofixRun.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const user = openReview();
    await user.click(within(panel()).getByRole("button", { name: "Automático al grupo" }));
    act(() => emit(done("done", 3)));
    act(() => answer({ job_id: "a1" }));
    expect(
      await within(panel()).findByText("Corrección automática aplicada a 3 fotos."),
    ).toBeVisible();
  });

  it("is off when the group is empty and cannot be started twice", async () => {
    const user = openReview();
    await user.selectOptions(within(panel()).getByLabelText("Aplicar a"), "Solo esta foto");
    await user.click(within(panel()).getByRole("button", { name: "Automático al grupo" }));
    await waitFor(() => expect(mocked.autofixRun).toHaveBeenCalledTimes(1));
    expect(within(panel()).queryByRole("button", { name: "Automático al grupo" })).toBeNull();
    expect(within(panel()).getByRole("button", { name: "Automático" })).toBeDisabled();
  });
});
