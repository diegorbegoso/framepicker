/** Full-screen for the immersive review. Outside the desktop shell (tests, a browser) it does nothing. */
export async function setFullscreen(on: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(on);
  } catch {
    // Not running inside Tauri, or the window refused: the in-app immersive layout still works.
  }
}
