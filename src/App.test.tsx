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

  it("shows the product name as the page heading", () => {
    engineWithTheme("light");
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Mejores Tomas" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(screen.getByRole("button", { name: "Ajustes" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("radio", { name: "Oscuro" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() => expect(settingsSetCalls()).toHaveLength(1));
    expect(settingsSetCalls()[0]?.[1]).toEqual({ key: "theme", value: "dark" });
  });

  it("falls back to light when the engine cannot answer", async () => {
    request.mockRejectedValue(new Error("engine down"));
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(screen.getByRole("radio", { name: "Claro" })).toBeChecked();
  });

  it("lets the keyboard pick the dark theme in the Tema group", async () => {
    engineWithTheme("light");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();
    const dark = screen.getByRole("radio", { name: "Oscuro" });
    dark.focus();
    await user.keyboard(" ");
    expect(dark).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
