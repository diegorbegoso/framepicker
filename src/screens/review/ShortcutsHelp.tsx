import { Kbd } from "../../components/Kbd.tsx";
import { Panel } from "../../components/Panel.tsx";
import styles from "./ShortcutsHelp.module.css";

const SHORTCUTS: { keys: string[]; text: string }[] = [
  { keys: ["←", "→"], text: "Foto anterior o siguiente" },
  { keys: ["Espacio"], text: "Elegir o quitar la foto" },
  { keys: ["Intro"], text: "Confirmar la ráfaga y pasar a la siguiente" },
  { keys: ["↑", "↓"], text: "Ráfaga anterior o siguiente" },
  { keys: ["Z"], text: "Alternar entre ajustar y 100 %" },
  { keys: ["C"], text: "Comparar dos fotos" },
  { keys: ["F"], text: "Pantalla completa" },
  { keys: ["Mayús", "←"], text: "Mover la foto ampliada" },
];

export function ShortcutsHelp() {
  return (
    <Panel title="Atajos de teclado" icon="keyboard">
      <ul className={styles.list}>
        {SHORTCUTS.map(({ keys, text }) => (
          <li key={text} className={styles.row}>
            <span className={styles.keys}>
              {keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
