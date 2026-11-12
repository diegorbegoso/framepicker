import { Icon, type IconName } from "../../components/Icon.tsx";
import styles from "./Hero.module.css";

type Props = {
  disabled: boolean;
  onFolder: () => void;
  onFiles: () => void;
};

const PROMISES = [
  "Todo se queda en tu equipo",
  "Sin nube ni cuentas",
  "Tus originales no se tocan",
];

function Action({
  primary,
  icon,
  name,
  text,
  disabled,
  onClick,
}: {
  primary: boolean;
  icon: IconName;
  name: string;
  text: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      className={`${styles.action} ${primary ? styles.primary : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.actionIcon}>
        <Icon name={icon} size={22} />
      </span>
      <span className={styles.actionText}>
        <strong>{name}</strong>
        <span>{text}</span>
      </span>
    </button>
  );
}

/** The headline, the two ways to start and what the person can count on. */
export function Hero({ disabled, onFolder, onFiles }: Props) {
  return (
    <>
      <p className={styles.kicker}>Mejores Tomas</p>
      <h2 id="home-title" className={styles.title}>
        Elige las mejores tomas de tus ráfagas
      </h2>
      <p className={styles.lead}>
        Revisa cientos de fotos en minutos: el programa agrupa las ráfagas y te propone la más
        nítida de cada una.
      </p>
      <div className={styles.actions}>
        <Action
          primary
          icon="folder"
          name="Elegir carpeta"
          text="Analiza todas las fotos de una carpeta"
          disabled={disabled}
          onClick={onFolder}
        />
        <Action
          primary={false}
          icon="images"
          name="Elegir archivos"
          text="Escoge fotos sueltas, de donde sea"
          disabled={disabled}
          onClick={onFiles}
        />
      </div>
      <ul className={styles.chips} aria-label="Garantías">
        {PROMISES.map((text) => (
          <li key={text} className={styles.chip}>
            <Icon name="check" size={14} />
            {text}
          </li>
        ))}
      </ul>
    </>
  );
}
