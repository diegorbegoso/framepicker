import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineName } from "../components/InlineName.tsx";
import * as engine from "../lib/engine.ts";
import { EngineError } from "../lib/engine.ts";
import { previews } from "../lib/previews.ts";
import { RESULT } from "./fixtures.ts";
import { HomeScreen } from "./HomeScreen.tsx";
import { ReviewScreen } from "./ReviewScreen.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    sessionsList: vi.fn(),
    sessionForget: vi.fn(),
    sessionRename: vi.fn(),
    sessionTouch: vi.fn(),
    select: vi.fn(),
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
  label: "Selección del 12 nov, 14:32",
  folder: "C:\\fotos",
  photos: 40,
  bursts: 12,
  picked: 12,
  reviewed: 3,
  edited: 0,
  updated_at: new Date().toISOString(),
  last_burst_id: null,
  available: true,
  covers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
  mocked.onEngineEvent.mockResolvedValue(() => undefined);
  mocked.sessionsList.mockResolvedValue([SESSION]);
  mocked.sessionTouch.mockResolvedValue({ session_id: "s1" });
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

describe("InlineName", () => {
  function setup(onSave = vi.fn().mockResolvedValue(undefined)) {
    const user = userEvent.setup();
    render(<InlineName value="Boda" label="Cambiar el nombre de Boda" onSave={onSave} />);
    return { user, onSave };
  }

  it("turns into a field on the pencil and saves on Enter", async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole("button", { name: "Cambiar el nombre de Boda" }));
    const field = screen.getByRole("textbox", { name: "Nombre de la sesión" });
    expect(field).toHaveFocus();
    await user.keyboard("{Control>}a{/Control}Boda de Ana{Enter}");
    expect(onSave).toHaveBeenCalledWith("Boda de Ana");
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });

  it("cancels with Escape and does not save an unchanged or empty name", async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole("button", { name: "Cambiar el nombre de Boda" }));
    await user.keyboard("{Control>}a{/Control}Otro{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cambiar el nombre de Boda" }));
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Cambiar el nombre de Boda" }));
    await user.keyboard("{Control>}a{/Control}{Backspace}{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("stays open and says so when the name cannot be saved", async () => {
    const { user } = setup(vi.fn().mockRejectedValue(new Error("no")));
    await user.click(screen.getByRole("button", { name: "Cambiar el nombre de Boda" }));
    await user.keyboard("{Control>}a{/Control}Nuevo{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar el nombre.");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

describe("naming a session on Inicio", () => {
  it("lets you give a loose selection a name of your own", async () => {
    mocked.sessionRename.mockResolvedValue("Fiesta de Ana");
    const user = userEvent.setup();
    render(<HomeScreen onResult={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Cambiar el nombre de Selección del 12 nov, 14:32",
      }),
    );
    await user.keyboard("{Control>}a{/Control}Fiesta de Ana{Enter}");
    expect(mocked.sessionRename).toHaveBeenCalledWith("s1", "Fiesta de Ana");
    expect(await screen.findByText("Fiesta de Ana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar Fiesta de Ana" })).toBeInTheDocument();
  });
});

describe("removing a session", () => {
  async function ask() {
    const user = userEvent.setup();
    render(<HomeScreen onResult={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Quitar Selección del 12 nov, 14:32" }),
    );
    return { user, dialog: screen.getByRole("dialog", { name: "¿Quitar esta sesión?" }) };
  }

  it("shows that it is working and cannot be pressed twice", async () => {
    let finish: () => void = () => undefined;
    mocked.sessionForget.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ session_id: "s1" });
      }),
    );
    const { user, dialog } = await ask();
    await user.click(within(dialog).getByRole("button", { name: "Quitar sesión" }));
    expect(within(dialog).getByRole("button", { name: "Quitando…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    mocked.sessionsList.mockResolvedValue([]);
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocked.sessionForget).toHaveBeenCalledTimes(1);
  });

  it("keeps the question open with the engine's reason when it fails, and lets you retry", async () => {
    mocked.sessionForget.mockRejectedValueOnce(
      new EngineError(-32603, "OperationalError: database is locked"),
    );
    const { user, dialog } = await ask();
    await user.click(within(dialog).getByRole("button", { name: "Quitar sesión" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No se pudo quitar la sesión (OperationalError: database is locked). Vuelve a intentarlo.",
    );
    mocked.sessionForget.mockResolvedValue({ session_id: "s1" });
    mocked.sessionsList.mockResolvedValue([]);
    await user.click(within(dialog).getByRole("button", { name: "Quitar sesión" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("the name in the review bar", () => {
  it("shows the session's name and can change it", async () => {
    mocked.sessionRename.mockResolvedValue("Vasco 1 año");
    const user = userEvent.setup();
    render(
      <ReviewScreen
        sessionId="s1"
        initial={{ ...RESULT, label: "VASCO" }}
        theme="light"
        onThemeChange={vi.fn()}
        immersive={false}
        onImmersiveChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByText("VASCO")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cambiar el nombre de VASCO" }));
    await user.keyboard("{Control>}a{/Control}Vasco 1 año{Enter}");
    expect(mocked.sessionRename).toHaveBeenCalledWith("s1", "Vasco 1 año");
    expect(await screen.findByText("Vasco 1 año")).toBeInTheDocument();
  });
});
