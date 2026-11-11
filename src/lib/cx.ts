/** Joins class names, skipping the ones that are off: cx(styles.root, active && styles.active). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
