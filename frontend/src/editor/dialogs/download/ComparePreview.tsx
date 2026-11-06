import { MoveHorizontal } from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { fitBox } from "../../engine/pageSizes";
import { t } from "../../strings";
import {
  DETAIL_ZOOM,
  LINE_GRAB,
  type Pan,
  centerPan,
  dragPan,
  keyPan,
  splitAt,
  wheelPan,
} from "./pan";
import styles from "./download.module.css";

export type Zoom = "fit" | "detail";

interface ComparePreviewProps {
  /** The page as drawn, and the file as it will be; without `after` only the page shows. */
  before: string | null;
  after: string | null;
  size: { width: number; height: number };
  zoom: Zoom;
  /** The label over the file's side ("JPG 82 · 65 KB"). */
  tag: string | null;
}

const SPLIT_STEP = 5;

/**
 * The page and the file side by side under a line that moves (pointer or arrow keys). In Detail the picture is three
 * times larger and moves around (drag, wheel, Shift + wheel, arrow keys); the file's side is clipped by a box the size
 * of the frame, so the line stays where it is while the picture moves.
 */
export function ComparePreview({
  before,
  after,
  size,
  zoom,
  tag,
}: ComparePreviewProps) {
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [split, setSplit] = useState(50);
  const [pan, setPan] = useState<Pan>(centerPan);
  const drag = useRef<{
    mode: "split" | "pan";
    x: number;
    y: number;
    pan: Pan;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const detail = zoom === "detail";
  const compare = after !== null;

  // The frame keeps the page's proportions inside whatever room the stage has.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setBox(fitBox(size, width, height));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  // Detail starts from the middle each time it is turned on.
  const [panZoom, setPanZoom] = useState(zoom);
  if (panZoom !== zoom) {
    setPanZoom(zoom);
    setPan(centerPan());
  }

  // React's wheel listener is passive: the page would scroll instead of the picture.
  useEffect(() => {
    const el = frame.current;
    if (!el || !detail) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setPan((p) => wheelPan(p, e, r));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [detail]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!compare && !detail) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const nearLine =
      compare &&
      Math.abs(e.clientX - (r.left + (r.width * split) / 100)) < LINE_GRAB;
    if (detail && !nearLine) {
      drag.current = { mode: "pan", x: e.clientX, y: e.clientY, pan };
      setPanning(true);
    } else {
      drag.current = { mode: "split", x: e.clientX, y: e.clientY, pan };
      setSplit(splitAt(e.clientX, r));
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (d.mode === "split") setSplit(splitAt(e.clientX, r));
    else setPan(dragPan(d.pan, e.clientX - d.x, e.clientY - d.y, r));
  };
  const end = (): void => {
    drag.current = null;
    setPanning(false);
  };
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (detail) {
      const next = keyPan(pan, e.key);
      if (!next) return;
      e.preventDefault();
      setPan(next);
      return;
    }
    if (!compare) return;
    const step =
      e.key === "ArrowLeft"
        ? -SPLIT_STEP
        : e.key === "ArrowRight"
          ? SPLIT_STEP
          : e.key === "Home"
            ? -100
            : e.key === "End"
              ? 100
              : 0;
    if (step === 0) return;
    e.preventDefault();
    setSplit((s) => Math.min(100, Math.max(0, s + step)));
  };

  const style = {
    ...(box ?? { width: 0, height: 0 }),
    "--split": `${split}%`,
    "--px": `${pan.x}%`,
    "--py": `${pan.y}%`,
    "--zoom": `${DETAIL_ZOOM * 100}%`,
  } as CSSProperties;
  const sliderProps =
    compare && !detail
      ? {
          role: "slider",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(split),
          "aria-label": t.dialog.downloadCompare,
        }
      : {
          role: "group",
          "aria-label": detail
            ? t.dialog.downloadCompareDetail
            : t.dialog.downloadPreview,
        };
  return (
    <div ref={stage} className={styles.stage}>
      <div
        ref={frame}
        className={`${styles.frame} ${detail ? styles.zoomed : ""} ${panning ? styles.panning : ""} ${compare ? styles.comparing : ""}`}
        style={style}
        tabIndex={0}
        data-testid="download-compare"
        data-zoom={zoom}
        {...sliderProps}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
      >
        <div className={styles.checker} aria-hidden="true" />
        {before ? (
          <img
            className={styles.picture}
            src={before}
            alt=""
            draggable={false}
          />
        ) : null}
        {compare ? (
          <>
            <div className={styles.after} aria-hidden="true">
              <img
                className={styles.picture}
                src={after}
                alt=""
                draggable={false}
              />
            </div>
            <div className={styles.handle} aria-hidden="true">
              <MoveHorizontal size={16} />
            </div>
            <span
              className={`${styles.tag} ${styles.tagLeft}`}
              aria-hidden="true"
            >
              {t.dialog.downloadOriginal}
            </span>
            {tag ? (
              <span
                className={`${styles.tag} ${styles.tagRight}`}
                data-testid="download-compare-tag"
              >
                {tag}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
