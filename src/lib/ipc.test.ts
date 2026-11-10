import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { EngineError, engineRequest, ping } from "./ipc.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("ipc", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns the validated result of ping", async () => {
    invokeMock.mockResolvedValue({ pong: true, version: "0.1.0" });
    await expect(ping()).resolves.toEqual({ pong: true, version: "0.1.0" });
    expect(invokeMock).toHaveBeenCalledWith("engine_request", { method: "ping", params: {} });
  });

  it("rejects a malformed engine reply", async () => {
    invokeMock.mockResolvedValue({ pong: false });
    await expect(ping()).rejects.toThrow();
  });

  it("turns a JSON error body from the shell into an EngineError with its code", async () => {
    invokeMock.mockRejectedValue(JSON.stringify({ code: -32010, message: "path not allowed" }));
    const failure = await engineRequest("scan", { paths: [] }, z.unknown()).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(EngineError);
    expect((failure as EngineError).code).toBe(-32010);
  });

  it("wraps a plain-text failure as an internal error", async () => {
    invokeMock.mockRejectedValue("boom");
    const failure = await engineRequest("scan", {}, z.unknown()).catch((error: unknown) => error);
    expect((failure as EngineError).code).toBe(-32603);
  });
});
