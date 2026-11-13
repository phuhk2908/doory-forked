import { useId } from "react";
import { t } from "../../strings";
import styles from "./download.module.css";

interface SizeFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** The pixels of the (first) page at this size; null when the text is not a size. */
  pixels: { width: number; height: number } | null;
  /** Each page has its own size: the pixels differ by page. */
  mixed: boolean;
  /** Scaled down to what the browser can draw. */
  clamped: boolean;
  /** Extra chips, such as the preset's width (`1080w`). */
  extra: string[];
}

const CHIPS = ["1x", "2x", "3x", "4x"];

/** The size as people say it: `2x`, `1080w` or `1350h`, with quick chips and the pixels it makes. */
export function SizeField({
  value,
  onChange,
  pixels,
  mixed,
  clamped,
  extra,
}: SizeFieldProps) {
  const errorId = useId();
  const chips = [...CHIPS, ...extra.filter((c) => !CHIPS.includes(c))];
  return (
    <section className={styles.section}>
      <h3 className={styles.label}>
        {t.dialog.downloadScale}
        <small data-testid="download-size">
          {pixels
            ? `${mixed ? t.dialog.downloadEachSize : t.dialog.downloadPixels(pixels.width, pixels.height)}${clamped ? ` · ${t.dialog.downloadClamped}` : ""}`
            : ""}
        </small>
      </h3>
      <div className={styles.sizeRow}>
        <input
          className={styles.sizeInput}
          value={value}
          aria-label={t.dialog.downloadSize}
          aria-invalid={!pixels}
          aria-describedby={!pixels ? errorId : undefined}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className={styles.chips}>
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className={`${styles.chip} ${chip === value.trim() ? styles.on : ""}`}
              aria-pressed={chip === value.trim()}
              onClick={() => onChange(chip)}
            >
              {chip}
            </button>
          ))}
        </span>
      </div>
      {!pixels ? (
        <small id={errorId} className={styles.error} role="alert">
          {t.dialog.downloadSizeInvalid}
        </small>
      ) : null}
    </section>
  );
}
