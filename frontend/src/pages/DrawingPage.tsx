import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  DrawingEditor,
  type DrawingEditorHandle,
} from "@/drawing/DrawingEditor";
import type { DrawingDocument } from "@/drawing/model";
import { useDrawingRealtime } from "@/drawing/realtime";
import { useDrawingSession } from "@/drawing/session";
import { useAuth } from "@/features/auth/AuthProvider";
import { drawingsApi, isApiError } from "@/lib/api";
import { qk } from "@/lib/api/keys";
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [titleOverride, setTitleOverride] = useState<{
    id: string;
    title: string;
  } | null>(null);

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

  const session = useDrawingSession({
    delayMs: 700,
    canSave: () => Boolean(drawing),
    save: async (document) => {
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
    },
    onError: (error) => {
      setSaveError(
        isApiError(error) && error.isConflict
          ? "This whiteboard changed in another tab. Reload it before saving again."
          : "Could not save yet. Your changes are still on this page.",
      );
    },
  });
  useUnsavedGuard(session.dirty);

  function acceptRemote(document: DrawingDocument, revision: number): void {
    if (revision <= revisionRef.current) return;
    if (session.dirty) {
      setSaveError(
        "This whiteboard changed in another tab. Save or reload before continuing.",
      );
      return;
    }
    editorRef.current?.replaceDocument(document);
    revisionRef.current = revision;
    session.markSaved();
    setSaveError(null);
  }

  function handleRealtimeConflict(
    document: DrawingDocument | null,
    revision: number,
  ): void {
    if (document && revision > revisionRef.current && !session.dirty) {
      editorRef.current?.replaceDocument(document);
      revisionRef.current = revision;
      session.markSaved();
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
        onDocumentChange={(document) => {
          setSaveError(null);
          session.queue(document);
        }}
        onSaveNow={session.saveNow}
      />
    </div>
  );
}
