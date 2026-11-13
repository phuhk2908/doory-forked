import type { ReactNode } from "react";
import type { ExportFormat } from "../../engine/export/registry";
import type { RasterFormat } from "../../engine/export/raster";
import { formatBytes } from "../../engine/export/video/estimate";
import { t } from "../../strings";
import styles from "./download.module.css";

interface FormatPickerProps {
  /** Picture formats (with estimated sizes), then the others as chips. */
  pictures: ExportFormat[];
  others: ExportFormat[];
  value: string;
  onChange: (id: string) => void;
  sizes: Partial<Record<RasterFormat, number>>;
  approximate: Partial<Record<RasterFormat, boolean>>;
  /** JPG can't keep a transparent background. */
  transparent: boolean;
  /** A line under the formats (a platform's limits, a note on the chosen format). */
  hint: ReactNode;
  disabled?: boolean;
}

/** The format: cards with the estimated size of a page in each picture format, and chips for PDF, SVG and video. */
export function FormatPicker({
  pictures,
  others,
  value,
  onChange,
  sizes,
  approximate,
  transparent,
  hint,
  disabled,
}: FormatPickerProps) {
  const known = pictures.filter(
    (f) =>
      sizes[f.id as RasterFormat] !== undefined &&
      !(transparent && f.id === "jpg"),
  );
  const smallest =
    known.length > 1
      ? known.reduce((a, b) =>
          (sizes[a.id as RasterFormat] ?? Infinity) <=
          (sizes[b.id as RasterFormat] ?? Infinity)
            ? a
            : b,
        ).id
      : null;
  return (
    <fieldset className={styles.section} disabled={disabled}>
      <legend className={styles.label}>
        {t.dialog.downloadFormat}
        {pictures.some((f) => f.id === value) ? (
          <small>{t.dialog.downloadPerPage}</small>
        ) : null}
      </legend>
      {pictures.length > 0 ? (
        <div
          className={styles.formatGrid}
          role="radiogroup"
          aria-label={t.dialog.downloadFormat}
        >
          {pictures.map((f) => {
            const bytes = sizes[f.id as RasterFormat];
            const dim = transparent && f.id === "jpg";
            const note =
              f.id === smallest
                ? t.dialog.downloadSmallest
                : (t.dialog.downloadFormatNotes[f.id] ?? "");
            return (
              <label
                key={f.id}
                className={`${styles.formatCard} ${f.id === value ? styles.on : ""} ${dim ? styles.dim : ""}`}
                title={dim ? t.dialog.downloadNoAlpha : undefined}
              >
                <input
                  type="radio"
                  name="export-format"
                  checked={f.id === value}
                  onChange={() => onChange(f.id)}
                />
                <strong>{f.label}</strong>
                <span
                  className={`${styles.bytes} ${f.id === smallest ? styles.min : ""}`}
                  data-testid={`download-size-${f.id}`}
                >
                  {bytes !== undefined
                    ? `${approximate[f.id as RasterFormat] || f.id === "avif" ? "≈ " : ""}${formatBytes(bytes)}`
                    : "…"}
                </span>
                <small>{note}</small>
              </label>
            );
          })}
        </div>
      ) : null}
      {others.length > 0 ? (
        <div
          className={styles.chips}
          role="radiogroup"
          aria-label={t.dialog.downloadMoreFormats}
        >
          {others.map((f) => (
            <label
              key={f.id}
              className={`${styles.chip} ${f.id === value ? styles.on : ""}`}
            >
              <input
                type="radio"
                name="export-format"
                checked={f.id === value}
                onChange={() => onChange(f.id)}
              />
              {f.label}
            </label>
          ))}
        </div>
      ) : null}
      {hint}
    </fieldset>
  );
}
