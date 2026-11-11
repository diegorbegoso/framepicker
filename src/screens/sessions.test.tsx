import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { previews } from "../lib/previews.ts";
import { relativeTime } from "../lib/relativeTime.ts";
import { RESULT } from "./fixtures.ts";
import { HomeScreen } from "./HomeScreen.tsx";
import { ReviewScreen } from "./ReviewScreen.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    scan: vi.fn(),
    analyze: vi.fn(),
    select: vi.fn(),
    sessionsList: vi.fn(),
    sessionTouch: vi.fn(),
    sessionForget: vi.fn(),
    pickFolder: vi.fn(),
    pickFiles: vi.fn(),
    preview: vi.fn(),
    getEdits: vi.fn(),
    listLuts: vi.fn(),
    onEngineEvent: vi.fn(),
  };
});
vi.mock("../lib/window.ts", () => ({ setFullscreen: vi.fn() }));

const mocked = vi.mocked(engine);

const SESSION: engine.SessionSummary = {
  id: "s1",
  label: "BODA AÑO",
  folder: "C:\\fotos\\BODA AÑO",
  photos: 120,
  bursts: 40,
  picked: 38,
  reviewed: 12,
  edited: 5,
  updated_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  last_burst_id: "b2",
  available: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
  mocked.onEngineEvent.mockResolvedValue(() => undefined);
  mocked.sessionsList.mockResolvedValue([SESSION]);
  mocked.sessionTouch.mockResolvedValue({ session_id: "s1" });
  mocked.select.mockResolvedValue(RESULT);
  mocked.getEdits.mockResolvedValue({});
  mocked.listLuts.mockResolvedValue([]);
  mocked.preview.mockResolvedValue({
    url: "data:image/jpeg;base64,AAAA",
    width: 1600,
    height: 1067,
    sourceWidth: 6000,
    sourceHeight: 4000,
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  it("says it in Spanish", () => {
    expect(relativeTime("2026-11-11T11:59:50Z", now)).toBe("hace un momento");
    expect(relativeTime("2026-11-11T11:30:00Z", now)).toBe("hace 30 minutos");
    expect(relativeTime("2026-11-11T09:00:00Z", now)).toBe("hace 3 horas");
    expect(relativeTime("2026-11-10T12:00:00Z", now)).toBe("ayer");
    expect(relativeTime("nonsense", now)).toBe("");
  });
});

describe("the list of earlier sessions on Inicio", () => {
  it("shows what was done and when", async () => {
    render(<HomeScreen onResult={vi.fn()} />);
    const list = await screen.findByRole("region", { name: "Continuar donde lo dejaste" });
    expect(within(list).getByText("BODA AÑO")).toBeInTheDocument();
    expect(
      within(list).getByText(/120 fotos · 38 elegidas · 12 de 40 ráfagas revisadas/),
    ).toBeVisible();
    expect(within(list).getByText(/5 corregidas/)).toBeInTheDocument();
    expect(within(list).getByText("hace 3 horas")).toBeInTheDocument();
  });

  it("shows nothing when there is nothing to continue", async () => {
    mocked.sessionsList.mockResolvedValue([]);
    render(<HomeScreen onResult={vi.fn()} />);
    await waitFor(() => expect(mocked.sessionsList).toHaveBeenCalled());
    expect(screen.queryByText("Continuar donde lo dejaste")).not.toBeInTheDocument();
  });

  it("continues a session: asks for its picks and opens the review", async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<HomeScreen onResult={onResult} />);
    await user.click(await screen.findByRole("button", { name: "Continuar BODA AÑO" }));
    expect(mocked.select).toHaveBeenCalledWith("s1");
    expect(mocked.scan).not.toHaveBeenCalled();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("s1", RESULT));
  });

  it("will not continue when the photos are gone, and says why", async () => {
    mocked.sessionsList.mockResolvedValue([{ ...SESSION, available: false }]);
    render(<HomeScreen onResult={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Continuar BODA AÑO" })).toBeDisabled();
    expect(screen.getByText(/No encuentro estas fotos/)).toBeInTheDocument();
  });

  it("forgets a session only after asking, and says the photos are safe", async () => {
    mocked.sessionForget.mockResolvedValue({ session_id: "s1" });
    const user = userEvent.setup();
    render(<HomeScreen onResult={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Quitar BODA AÑO" }));
    const ask = screen.getByRole("dialog", { name: "¿Quitar esta sesión?" });
    expect(within(ask).getByText(/Tus fotos no se tocan/)).toBeInTheDocument();
    expect(mocked.sessionForget).not.toHaveBeenCalled();
    mocked.sessionsList.mockResolvedValue([]);
    await user.click(within(ask).getByRole("button", { name: "Quitar sesión" }));
    await waitFor(() => expect(mocked.sessionForget).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.queryByText("BODA AÑO")).not.toBeInTheDocument());
  });

  it("keeps the session when you cancel the question", async () => {
    const user = userEvent.setup();
    render(<HomeScreen onResult={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Quitar BODA AÑO" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(mocked.sessionForget).not.toHaveBeenCalled();
    expect(screen.getByText("BODA AÑO")).toBeInTheDocument();
  });
});

describe("picking the same photos again", () => {
  it("goes straight back to the saved work without analysing again", async () => {
    mocked.pickFolder.mockResolvedValue("C:\\fotos\\BODA AÑO");
    mocked.scan.mockResolvedValue({
      session_id: "s1",
      photos: [{ id: "a", path: "C:\\fotos\\a.jpg", format: "jpg", size_bytes: 1 }],
      skipped: 0,
      resumed: true,
    });
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<HomeScreen onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Elegir carpeta" }));
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith("s1", RESULT, "Recuperé tu avance de estas fotos."),
    );
    expect(mocked.analyze).not.toHaveBeenCalled();
  });
});

describe("the review of a saved session", () => {
  function open(lastBurst: string | null | undefined, notice?: string) {
    const user = userEvent.setup();
    render(
      <ReviewScreen
        sessionId="s1"
        initial={{ ...RESULT, last_burst_id: lastBurst }}
        notice={notice}
        theme="light"
        onThemeChange={vi.fn()}
        immersive={false}
        onImmersiveChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    return user;
  }

  it("opens on the burst that was being looked at, on its chosen photo", () => {
    open("b2");
    expect(screen.getByText("1 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Ráfaga 2/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("opens on the first burst when none is remembered", () => {
    open(undefined);
    expect(screen.getByText("2 de 3")).toBeInTheDocument();
  });

  it("remembers each burst it goes to", async () => {
    const user = open(null);
    await user.click(screen.getByRole("button", { name: /^Ráfaga 2/ }));
    expect(mocked.sessionTouch).toHaveBeenCalledWith("s1", "b2");
  });

  it("says when earlier work was recovered", () => {
    open("b1", "Recuperé tu avance de estas fotos.");
    expect(screen.getByText("Recuperé tu avance de estas fotos.")).toBeInTheDocument();
  });

  it("says that the progress is saved where you leave", () => {
    open("b1");
    expect(screen.getByText("Tu avance queda guardado")).toBeInTheDocument();
  });
});
