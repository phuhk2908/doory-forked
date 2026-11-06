import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  DrawingEditor,
  type DrawingEditorHandle,
} from "@/drawing/DrawingEditor";
import type { DrawingDocument } from "@/drawing/model";
import { useDrawingRealtime } from "@/drawing/realtime";
import { useAuth } from "@/features/auth/AuthProvider";
import { drawingsApi, isApiError } from "@/lib/api";
import { qk } from "@/lib/api/keys";
import { useLatest } from "@/lib/useLatest";
import { usePageMeta } from "@/lib/usePageMeta";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import {
  EditorProblemPage,
  EditorSkeleton,
} from "@/features/editor/EditorStates";
import styles from "./DrawingPage.module.css";

function problemFor(
  error: unknown,
): "offline" | "not-found" | "forbidden" | "error" {
  if (isApiError(error)) {
    if (error.isNetwork) return "offline";
    if (error.status === 404) return "not-found";
    if (error.status === 403) return "forbidden";
  }
  return "error";
}

export default function DrawingPage() {
  const { id = "" } = useParams();
  const { config, status } = useAuth();
  const editorRef = useRef<DrawingEditorHandle>(null);
  const revisionRef = useRef(1);
  const pendingRef = useRef<DrawingDocument | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [titleOverride, setTitleOverride] = useState<{
    id: string;
    title: string;
  } | null>(null);
  useUnsavedGuard(dirty);

  const query = useQuery({
    queryKey: qk.drawings.detail(id),
    queryFn: ({ signal }) => drawingsApi.get(id, signal),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const drawing = query.data;
  const drawingTitle =
    titleOverride?.id === id
      ? titleOverride.title
      : (drawing?.title ?? "Whiteboard");
  usePageMeta({ title: drawingTitle, noindex: true });

  function acceptRemote(document: DrawingDocument, revision: number): void {
    if (revision <= revisionRef.current) return;
    if (dirty || pendingRef.current || inFlightRef.current) {
      setSaveError(
        "This whiteboard changed in another tab. Save or reload before continuing.",
      );
      return;
    }
    editorRef.current?.replaceDocument(document);
    revisionRef.current = revision;
    setDirty(false);
    setSaveError(null);
  }

  function handleRealtimeConflict(
    document: DrawingDocument | null,
    revision: number,
  ): void {
    if (
      document &&
      revision > revisionRef.current &&
      !dirty &&
      !pendingRef.current &&
      !inFlightRef.current
    ) {
      editorRef.current?.replaceDocument(document);
      revisionRef.current = revision;
      setSaveError(null);
      return;
    }
    setSaveError(
      "This whiteboard changed in another tab. Save or reload before continuing.",
    );
  }

  const realtime = useDrawingRealtime({
    drawingId: id,
    enabled:
      status === "authenticated" &&
      config.features.realtime === true &&
      !!drawing,
    onDocument: acceptRemote,
    onConflict: handleRealtimeConflict,
    onPresence: () => undefined,
  });

  useEffect(() => {
    if (drawing) revisionRef.current = drawing.revision;
  }, [drawing]);

  function queueSave(document: DrawingDocument, immediate = false): void {
    pendingRef.current = document;
    setDirty(true);
    setSaveError(null);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = immediate
      ? null
      : window.setTimeout(() => {
          timerRef.current = null;
          void savePending();
        }, 700);
    if (immediate) void savePending().catch(() => undefined);
  }

  async function savePending(): Promise<void> {
    if (inFlightRef.current) {
      await inFlightRef.current;
      if (pendingRef.current) await savePending();
      return;
    }
    const document = pendingRef.current;
    if (!document) {
      setDirty(false);
      return;
    }
    pendingRef.current = null;
    const task = (async () => {
      try {
        const saved = await drawingsApi.saveDocument(
          id,
          document,
          revisionRef.current,
        );
        revisionRef.current = saved.revision;
        try {
          const thumbnail = await editorRef.current?.export({
            format: "png",
            bounds: "content",
            padding: 24,
            scale: 1,
          });
          if (thumbnail) await drawingsApi.uploadThumbnail(id, thumbnail);
        } catch {
          // The document is already safe; a missing thumbnail should not make the editor look unsaved.
        }
        realtime.publish(saved.document, saved.revision);
        if (!pendingRef.current) setDirty(false);
      } catch (error) {
        pendingRef.current = document;
        setSaveError(
          isApiError(error) && error.isConflict
            ? "This whiteboard changed in another tab. Reload it before saving again."
            : "Could not save yet. Your changes are still on this page.",
        );
        throw error;
      }
    })();
    inFlightRef.current = task;
    try {
      await task;
    } finally {
      inFlightRef.current = null;
    }
    if (pendingRef.current) await savePending();
  }

  const latestSavePending = useLatest(savePending);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void latestSavePending
        .get()()
        .catch(() => undefined);
    },
    [latestSavePending],
  );

  async function renameDrawing(nextTitle: string): Promise<void> {
    const updated = await drawingsApi.patch(id, { title: nextTitle });
    setTitleOverride({ id, title: updated.title });
  }

  if (query.isPending)
    return <EditorSkeleton label="Opening your whiteboard" />;
  if (query.isError)
    return (
      <EditorProblemPage
        problem={problemFor(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  if (!drawing) return null;

  return (
    <div className={styles.page}>
      {saveError ? (
        <div className={styles.error} role="alert">
          {saveError}
        </div>
      ) : null}
      <div className={styles.accountBar} aria-live="polite">
        <span>
          {realtime.status === "live"
            ? realtime.peerCount > 1
              ? "Live · " + realtime.peerCount + " editors"
              : "Live"
            : realtime.status === "connecting"
              ? "Connecting…"
              : "Offline — changes still save"}
        </span>
      </div>
      <DrawingEditor
        ref={editorRef}
        initialDocument={drawing.document}
        title={drawingTitle}
        onTitleChange={renameDrawing}
        onDocumentChange={(document) => queueSave(document)}
        onSaveNow={async (document) => {
          queueSave(document, true);
          await savePending();
        }}
      />
    </div>
  );
}
