import { useEffect, useState } from "react";
import styles from "./App.module.css";
import { Icon } from "./components/Icon.tsx";
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

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [theme, setTheme] = useState<Theme>("light");
  const [review, setReview] = useState<Review | null>(null);
  const [immersive, setImmersive] = useState(false);

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

  // The review stays mounted while Ajustes is open, so picks, zoom and scroll are still there.
  const showReview = screen === "home" && review !== null;
  const hideChrome = showReview && immersive;

  return (
    <div className={styles.shell}>
      {hideChrome ? null : (
        <header className={styles.header}>
          <div className={styles.brand}>
            <span className={styles.mark}>
              <Icon name="camera" size={18} />
            </span>
            <h1 className={styles.title}>Mejores Tomas</h1>
          </div>
          <nav aria-label="Principal" className={styles.nav}>
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.navButton}
                aria-current={screen === item.id ? "page" : undefined}
                onClick={() => setScreen(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>
      )}
      <main className={showReview ? `${styles.main} ${styles.full}` : styles.main}>
        {review ? (
          <div className={styles.reviewHost} hidden={!showReview}>
            <ReviewScreen
              key={review.sessionId}
              sessionId={review.sessionId}
              initial={review.result}
              active={showReview}
              immersive={immersive}
              onImmersiveChange={setImmersive}
              onReset={() => {
                setImmersive(false);
                setReview(null);
              }}
            />
          </div>
        ) : null}
        {screen === "settings" ? (
          <div className={styles.page}>
            <SettingsScreen theme={theme} onThemeChange={setTheme} />
          </div>
        ) : review ? null : (
          <div className={styles.page}>
            <HomeScreen onResult={(sessionId, result) => setReview({ sessionId, result })} />
          </div>
        )}
      </main>
    </div>
  );
}
