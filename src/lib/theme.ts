import { z } from "zod";
import { engineRequest } from "./ipc.ts";

export type Theme = "light" | "dark";

const ThemeSchema = z.enum(["light", "dark"]);
const SettingsTheme = z.object({ theme: ThemeSchema }).loose();
const SavedSetting = z.object({ key: z.literal("theme"), value: ThemeSchema });

/** Light is the default; dark only when the person chose it. Never follows the system theme. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** The stored theme, or "light" on any failure (engine down, bad reply, unknown value). */
export async function loadTheme(): Promise<Theme> {
  try {
    const settings = await engineRequest("settings_get", {}, SettingsTheme);
    return settings.theme;
  } catch {
    return "light";
  }
}

export async function saveTheme(theme: Theme): Promise<void> {
  await engineRequest("settings_set", { key: "theme", value: theme }, SavedSetting);
}
