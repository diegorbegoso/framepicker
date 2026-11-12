import { Icon, type IconName } from "../../components/Icon.tsx";
import styles from "./StepsRibbon.module.css";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "search", title: "Analiza", text: "Agrupa las ráfagas y mide la nitidez" },
  { icon: "images", title: "Revisa", text: "Elige la mejor toma de cada una" },
  { icon: "sliders", title: "Corrige", text: "Luz, color, recorte y LUT" },
  { icon: "download", title: "Exporta", text: "A otra carpeta, sin tocar el original" },
];

/** The four things the program does, in order. */
export function StepsRibbon() {
  return (
    <ol className={styles.root} aria-label="Cómo funciona">
      {STEPS.map((step, index) => (
        <li key={step.title} className={styles.step}>
          <span className={styles.icon}>
            <Icon name={step.icon} size={18} />
          </span>
          <span className={styles.text}>
            <strong>{`${index + 1}. ${step.title}`}</strong>
            <span>{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
