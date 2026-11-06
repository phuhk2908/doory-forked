import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { t } from "../../strings";
import styles from "./download.module.css";

interface MoreSettingsProps {
  open: boolean;
  onToggle: () => void;
  /** What the settings are now, after the title ("all pages, simple names"). */
  summary: string;
  children: ReactNode;
}

/** The settings most downloads leave alone (pages, file names, metadata…), folded away with a line that sums them up. */
export function MoreSettings({
  open,
  onToggle,
  summary,
  children,
}: MoreSettingsProps) {
  const id = useId();
  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <ChevronRight size={16} aria-hidden="true" className={styles.chevron} />
        <span className={styles.disclosureTitle}>
          {t.dialog.downloadMoreSettings}
        </span>
        <span className={styles.disclosureSummary}>· {summary}</span>
      </button>
      {open ? (
        <div id={id} className={styles.settings}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
