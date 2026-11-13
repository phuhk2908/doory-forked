import type { DocPage } from "@/types/document";
import { useEditor } from "../../context";
import { usePageSnapshot } from "../../workspace/useSnapshot";
import { t } from "../../strings";
import styles from "./download.module.css";

/** More pages than this show as "+N": each thumbnail costs a page render. */
const MAX_THUMBS = 12;

function Thumb({
  page,
  index,
  shown,
  chosen,
  onShow,
}: {
  page: DocPage;
  index: number;
  shown: boolean;
  chosen: boolean;
  onShow: () => void;
}) {
  const editor = useEditor();
  const size = editor.pageSizeOf(page.id);
  const url = usePageSnapshot(page, size);
  return (
    <button
      type="button"
      className={`${styles.thumb} ${shown ? styles.on : ""} ${chosen ? "" : styles.off}`}
      style={{ aspectRatio: `${size.width / size.height}` }}
      aria-pressed={shown}
      aria-label={t.dialog.downloadPageOf(
        index + 1,
        editor.state.doc.pages.length,
      )}
      onClick={onShow}
    >
      {url ? <img src={url} alt="" draggable={false} /> : null}
    </button>
  );
}

interface PageThumbsProps {
  pages: DocPage[];
  shown: number;
  /** 0-based indexes of the pages the download takes. */
  chosen: ReadonlySet<number>;
  onShow: (index: number) => void;
  hint: string;
}

/** The pages under the preview: pick the one to look at; pages left out of the download are faded. */
export function PageThumbs({
  pages,
  shown,
  chosen,
  onShow,
  hint,
}: PageThumbsProps) {
  return (
    <div className={styles.pagesRow}>
      {pages.length > 1 ? (
        <div
          className={styles.thumbs}
          role="group"
          aria-label={t.dialog.downloadPagesShown}
        >
          {pages.slice(0, MAX_THUMBS).map((page, index) => (
            <Thumb
              key={page.id}
              page={page}
              index={index}
              shown={index === shown}
              chosen={chosen.has(index)}
              onShow={() => onShow(index)}
            />
          ))}
          {pages.length > MAX_THUMBS ? (
            <span className={styles.moreThumbs}>
              +{pages.length - MAX_THUMBS}
            </span>
          ) : null}
        </div>
      ) : null}
      <span className={styles.spacer} />
      <small className={styles.dragHint}>{hint}</small>
    </div>
  );
}
