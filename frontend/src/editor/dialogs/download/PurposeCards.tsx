import {
  type LucideIcon,
  AppWindow,
  Clapperboard,
  FileText,
  Globe,
  Layers,
  Printer,
} from "lucide-react";
import { PresetIcon } from "@/features/PresetIcon";
import { t } from "../../strings";
import type { Purpose, PurposeIcon } from "./purposes";
import styles from "./download.module.css";

const ICONS: Record<PurposeIcon, LucideIcon> = {
  preset: AppWindow,
  web: Globe,
  graphic: Layers,
  print: Printer,
  document: FileText,
  video: Clapperboard,
};

interface PurposeCardsProps {
  purposes: Purpose[];
  value: string | null;
  onPick: (purpose: Purpose) => void;
}

/** "What is it for?": each card sets a format and the options that suit it; the design's own size comes first. */
export function PurposeCards({ purposes, value, onPick }: PurposeCardsProps) {
  if (purposes.length === 0) return null;
  return (
    <section className={styles.section}>
      <h3 className={styles.label}>{t.dialog.downloadPurpose}</h3>
      <div className={styles.purposes}>
        {purposes.map((purpose) => {
          const Icon = ICONS[purpose.icon];
          const on = purpose.id === value;
          return (
            <button
              key={purpose.id}
              type="button"
              className={`${styles.purpose} ${on ? styles.on : ""}`}
              aria-pressed={on}
              data-purpose={purpose.id}
              onClick={() => onPick(purpose)}
            >
              {purpose.preset ? (
                <PresetIcon
                  preset={purpose.preset}
                  size={18}
                  className={styles.purposeIcon}
                />
              ) : (
                <Icon
                  size={18}
                  aria-hidden="true"
                  className={styles.purposeIcon}
                />
              )}
              <span className={styles.purposeText}>
                <strong>{purpose.label}</strong>
                <small>{purpose.hint}</small>
              </span>
              {purpose.own ? (
                <span className={styles.star}>{t.dialog.downloadYourSize}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
