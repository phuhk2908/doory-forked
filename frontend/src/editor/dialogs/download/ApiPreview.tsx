import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { t } from "../../strings";
import { Button } from "../../ui/Button";
import styles from "./download.module.css";

/** The MCP tool call and REST request that make the same file, to copy into a script or an assistant. */
export function ApiPreview({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  return (
    <section className={styles.section} data-testid="download-api">
      <h3 className={styles.label}>
        {t.dialog.downloadApiTitle}
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          onClick={copy}
        >
          {copied ? t.dialog.downloadApiCopied : t.dialog.downloadApiCopy}
        </Button>
      </h3>
      <pre className={styles.api}>{text}</pre>
    </section>
  );
}
