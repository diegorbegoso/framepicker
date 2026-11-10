import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export class EngineError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

const ErrorBody = z.object({ code: z.number(), message: z.string() });

function toEngineError(raw: unknown): EngineError {
  if (typeof raw === "string") {
    try {
      const body = ErrorBody.parse(JSON.parse(raw));
      return new EngineError(body.code, body.message);
    } catch {
      return new EngineError(-32603, raw);
    }
  }
  return new EngineError(-32603, String(raw));
}

/** Sends one request to the engine through the shell and validates the reply with `schema`. */
export async function engineRequest<S extends z.ZodType>(
  method: string,
  params: Record<string, unknown>,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await invoke("engine_request", { method, params });
  } catch (error) {
    throw toEngineError(error);
  }
  return schema.parse(raw);
}

export const PingResult = z.object({ pong: z.literal(true), version: z.string() });

export function ping() {
  return engineRequest("ping", {}, PingResult);
}
