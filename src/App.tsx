import { type CSSProperties, useEffect, useState } from "react";
import type { SelectResult } from "./lib/engine.ts";
import { applyTheme, loadTheme, type Theme } from "./lib/theme.ts";
import { HomeScreen } from "./screens/HomeScreen.tsx";
import { ReviewScreen } from "./screens/ReviewScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";

type Review = { sessionId: string; result: SelectResult };

type Screen = "home" | "settings";

const NAV: { id: Screen; label: string }[] = [
  { id: "home", label: "Inicio" },
  { id: "settings", label: "Ajustes" },
];

const shell: CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg)",
  color: "var(--fg)",
};

const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-4)",
  padding: "var(--space-3) var(--space-5)",
  borderBottom: "1px solid var(--divider)",
  background: "var(--surface)",
};

const title: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-lg)",
  lineHeight: "var(--leading-tight)",
};

const nav: CSSProperties = { display: "flex", gap: "var(--space-2)" };

const main: CSSProperties = {
  maxWidth: "var(--content-max)",
  margin: "0 auto",
  padding: "var(--space-5)",
};

function navButton(active: boolean): CSSProperties {
  return {
    font: "inherit",
    padding: "var(--space-2) var(--space-4)",
    borderRadius: "var(--radius-control)",
    border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
    background: active ? "var(--primary)" : "var(--surface)",
    color: active ? "var(--primary-fg)" : "var(--fg)",
    cursor: "pointer",
    transition: "background var(--dur-fast) var(--ease)",
  };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [theme, setTheme] = useState<Theme>("light");
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    applyTheme("light");
    let alive = true;
    void loadTheme().then((stored) => {
      if (!alive) return;
      applyTheme(stored);
      setTheme(stored);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={shell}>
      <header style={header}>
        <h1 style={title}>Mejores Tomas</h1>
        <nav aria-label="Principal" style={nav}>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              style={navButton(screen === item.id)}
              aria-current={screen === item.id ? "page" : undefined}
              onClick={() => setScreen(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main style={main}>
        {screen === "settings" ? (
          <SettingsScreen theme={theme} onThemeChange={setTheme} />
        ) : review ? (
          <ReviewScreen
            key={review.sessionId}
            sessionId={review.sessionId}
            initial={review.result}
            onReset={() => setReview(null)}
          />
        ) : (
          <HomeScreen onResult={(sessionId, result) => setReview({ sessionId, result })} />
        )}
      </main>
    </div>
  );
}
