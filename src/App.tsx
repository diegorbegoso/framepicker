import { useEffect, useState } from "react";
import styles from "./App.module.css";
import { TopBar } from "./components/TopBar.tsx";
import type { SelectResult } from "./lib/engine.ts";
import { applyTheme, loadTheme, type Theme } from "./lib/theme.ts";
import { HomeScreen } from "./screens/HomeScreen.tsx";
import { ReviewScreen } from "./screens/ReviewScreen.tsx";

type Review = { sessionId: string; result: SelectResult; notice?: string };

export function App() {
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

  // One bar at the top: the review draws its own (views, actions, theme); before it, a plain one.
  return (
    <div className={styles.shell}>
      {review ? (
        <main className={`${styles.main} ${styles.full}`}>
          <ReviewScreen
            key={review.sessionId}
            sessionId={review.sessionId}
            initial={review.result}
            notice={review.notice}
            theme={theme}
            onThemeChange={setTheme}
            immersive={immersive}
            onImmersiveChange={setImmersive}
            onReset={() => {
              setImmersive(false);
              setReview(null);
            }}
          />
        </main>
      ) : (
        <>
          <TopBar theme={theme} onThemeChange={setTheme} />
          <main className={styles.main}>
            <div className={styles.page}>
              <HomeScreen
                onResult={(sessionId, result, notice) => setReview({ sessionId, result, notice })}
              />
            </div>
          </main>
        </>
      )}
    </div>
  );
}
