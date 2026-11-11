import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { EngineError, type EngineEvent, type SelectResult } from "../lib/engine.ts";
import { HomeScreen } from "./HomeScreen.tsx";
import { ReviewScreen } from "./ReviewScreen.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    scan: vi.fn(),
    analyze: vi.fn(),
    cancel: vi.fn(),
    select: vi.fn(),
    setPick: vi.fn(),
    preview: vi.fn(),
    getSettings: vi.fn(),
    setSetting: vi.fn(),
    pickFolder: vi.fn(),
    pickFiles: vi.fn(),
    onEngineEvent: vi.fn(),
  };
});

const mocked = vi.mocked(engine);

function photo(id: string, selected: boolean, sharpnessNorm = 1) {
  return {
    id,
    path: `C:\\fotos\\${id}.jpg`,
    scores: {
      sharpness: 100 * sharpnessNorm,
      sharpness_norm: sharpnessNorm,
      exposure: 0.9,
      eyes_open: null,
      combined: 0.8 * sharpnessNorm,
    },
    selected,
    source: "auto" as const,
  };
}

const RESULT: SelectResult = {
  bursts: [
    {
      id: "b1",
      position: 0,
      photos: [photo("IMG_1", false, 0.5), photo("IMG_2", true), photo("IMG_3", false, 0.2)],
    },
    { id: "b2", position: 1, photos: [photo("IMG_4", true), photo("IMG_5", false, 0.4)] },
  ],
};

let emit: (event: EngineEvent) => void = () => undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.onEngineEvent.mockImplementation(async (callback) => {
    emit = callback;
    return () => undefined;
  });
  mocked.preview.mockResolvedValue("data:image/jpeg;base64,AAAA");
  mocked.getSettings.mockResolvedValue({
    theme: "light",
    weights: { sharpness: 0.6, exposure: 0.2, eyes: 0.2 },
    per_burst: 1,
    time_gap_s: 2,
    hamming_max: 22,
  });
  mocked.setSetting.mockImplementation(async (key, value) => ({ key, value }));
  mocked.setPick.mockImplementation(async (burstId, photoId, selected) => ({
    burst_id: burstId,
    photo_id: photoId,
    selected,
    source: "user" as const,
  }));
  mocked.select.mockResolvedValue(RESULT);
});

function renderReview() {
  return render(<ReviewScreen sessionId="s1" initial={RESULT} onReset={() => undefined} />);
}

describe("ReviewScreen", () => {
  it("lists every burst and marks the automatic picks", async () => {
    renderReview();
    expect(screen.getByRole("button", { name: "Ráfaga 1 · 3 fotos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ráfaga 2 · 2 fotos" })).toBeInTheDocument();
    expect(screen.getAllByText("Elegida")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "IMG_2.jpg, elegida" })).toBeInTheDocument();
    await waitFor(() => expect(mocked.preview).toHaveBeenCalledTimes(3));
  });

  it("toggles a pick with Space and moves with the arrow keys", async () => {
    const user = userEvent.setup();
    renderReview();
    const first = screen.getByRole("button", { name: "IMG_1.jpg, no elegida" });
    first.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    const third = screen.getByRole("button", { name: "IMG_3.jpg, no elegida" });
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
    await user.keyboard(" ");
    expect(mocked.setPick).toHaveBeenCalledWith("b1", "IMG_3", true);
    expect(screen.getByRole("button", { name: "IMG_3.jpg, elegida" })).toBeInTheDocument();
    expect(screen.getAllByText("Elegida")).toHaveLength(2);
  });

  it("shows the scores of the focused photo", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Ráfaga 2 · 2 fotos" }));
    const scores = screen.getByRole("region", { name: "Puntuaciones" });
    expect(within(scores).getByText("sin rostro")).toBeInTheDocument();
  });

  it("saves the per-burst count and selects again", async () => {
    const user = userEvent.setup();
    renderReview();
    await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled());
    const count = screen.getByRole("spinbutton", { name: "Fotos por ráfaga" });
    await user.clear(count);
    await user.type(count, "2");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(mocked.select).toHaveBeenCalledWith("s1"));
    expect(mocked.setSetting).toHaveBeenCalledWith("per_burst", 2);
    const perBurstOrder = mocked.setSetting.mock.invocationCallOrder[0] ?? Infinity;
    expect(perBurstOrder).toBeLessThan(mocked.select.mock.invocationCallOrder[0] ?? 0);
    for (const name of ["Peso de nitidez", "Peso de exposición", "Peso de ojos abiertos"]) {
      expect(screen.getByRole("slider", { name })).toBeInTheDocument();
    }
  });
});

describe("HomeScreen", () => {
  it("shows progress and hands the selection over when the job is done", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    mocked.pickFolder.mockResolvedValue("C:\\fotos");
    mocked.scan.mockResolvedValue({
      session_id: "s1",
      photos: ["a", "b", "c"].map((id) => ({
        id,
        path: `C:\\fotos\\${id}.jpg`,
        format: "jpg" as const,
        size_bytes: 1,
      })),
      skipped: 0,
    });
    mocked.analyze.mockResolvedValue({ job_id: "j1" });
    render(<HomeScreen onResult={onResult} />);
    await waitFor(() => expect(mocked.onEngineEvent).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Elegir carpeta" }));
    expect(mocked.scan).toHaveBeenCalledWith(["C:\\fotos"]);
    await waitFor(() => expect(mocked.analyze).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled());

    act(() =>
      emit({ method: "progress", params: { job_id: "j1", kind: "analyze", done: 1, total: 3 } }),
    );
    const bar = screen.getByRole("progressbar", { name: "Analizando 1 de 3 fotos" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByText("Analizando 1 de 3 fotos")).toBeVisible();

    act(() =>
      emit({
        method: "job_done",
        params: { job_id: "j1", kind: "analyze", state: "done", computed: 3, cached: 0, failed: 0 },
      }),
    );
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("s1", RESULT));
  });

  it("explains a folder that is not allowed", async () => {
    const user = userEvent.setup();
    mocked.pickFolder.mockResolvedValue("C:\\otra");
    mocked.scan.mockRejectedValue(new EngineError(-32010, "path not allowed"));
    render(<HomeScreen onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Elegir carpeta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esa carpeta no está permitida. Elígela de nuevo con el botón.",
    );
  });

  it("says when nothing compatible was found and shows no bursts", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    mocked.pickFiles.mockResolvedValue(["C:\\fotos\\notas.txt"]);
    mocked.scan.mockResolvedValue({ session_id: "s2", photos: [], skipped: 1 });
    render(<HomeScreen onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Elegir archivos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No encontré fotos compatibles en esa selección.",
    );
    expect(mocked.analyze).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Ráfaga/ })).not.toBeInTheDocument();
  });
});
