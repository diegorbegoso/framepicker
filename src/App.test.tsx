import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App.tsx";
import { engineRequest } from "./lib/ipc.ts";

vi.mock("./lib/ipc.ts", () => ({ engineRequest: vi.fn() }));

const request = vi.mocked(engineRequest);

function engineWithTheme(theme: string) {
  request.mockImplementation(async (method, params, schema) => {
    if (method === "settings_get")
      return schema.parse({
        theme,
        per_burst: 1,
        min_quality: { sharpness: 90, exposure: 0.55, eyes: 0.4 },
      });
    if (method === "settings_set") return schema.parse({ key: params.key, value: params.value });
    throw new Error(`unexpected method ${method}`);
  });
}

function settingsSetCalls() {
  return request.mock.calls.filter(([method]) => method === "settings_set");
}

describe("App", () => {
  beforeEach(() => {
    request.mockReset();
    delete document.documentElement.dataset.theme;
  });

  it("has a single top bar with the app mark and the theme switch, and no menu", () => {
    engineWithTheme("light");
    render(<App />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Framepicker" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Modo oscuro" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Ajustes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inicio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
  });

  it("applies the stored light theme", async () => {
    engineWithTheme("light");
    render(<App />);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("settings_get", {}, expect.anything()),
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("applies the stored dark theme", async () => {
    engineWithTheme("dark");
    render(<App />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("switches to dark and saves it exactly once", async () => {
    engineWithTheme("light");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("switch", { name: "Modo oscuro" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("switch", { name: "Modo oscuro" })).toBeChecked();
    await waitFor(() => expect(settingsSetCalls()).toHaveLength(1));
    expect(settingsSetCalls()[0]?.[1]).toEqual({ key: "theme", value: "dark" });
  });

  it("goes back to light with a second click", async () => {
    engineWithTheme("dark");
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Modo oscuro" })).toBeChecked());
    await user.click(screen.getByRole("switch", { name: "Modo oscuro" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("falls back to light when the engine cannot answer", async () => {
    request.mockRejectedValue(new Error("engine down"));
    render(<App />);
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Modo oscuro" })).not.toBeChecked();
  });

  it("lets the keyboard flip the theme", async () => {
    engineWithTheme("light");
    const user = userEvent.setup();
    render(<App />);
    screen.getByRole("switch", { name: "Modo oscuro" }).focus();
    await user.keyboard(" ");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
