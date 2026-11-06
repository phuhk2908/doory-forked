import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DrawingEditor,
  type DrawingEditorHandle,
} from "@/drawing/DrawingEditor";
import type { DrawingDocument } from "@/drawing/model";
import { drawingLocalRepository, type LocalDrawing } from "@/drawing/local";
import {
  drawingRoomEditStorageKey,
  drawingRoomHash,
  drawingRoomOwnerStorageKey,
  drawingRoomViewStorageKey,
} from "@/drawing/roomLink";
import { drawingRoomsApi, drawingsApi, isApiError } from "@/lib/api";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAuthModal } from "@/features/auth/AuthModalProvider";
import { Button, Dialog } from "@/ui";
import {
  EditorProblemPage,
  EditorSkeleton,
} from "@/features/editor/EditorStates";
import { useLatest } from "@/lib/useLatest";
import { usePageMeta } from "@/lib/usePageMeta";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import styles from "./DrawingPage.module.css";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; drawing: LocalDrawing }
  | { kind: "missing" }
  | { kind: "error" };

export default function LocalDrawingPage() {
  const { localId = "" } = useParams();
  const navigate = useNavigate();
  const { status } = useAuth();
  const { openAuthModal } = useAuthModal();
  const editorRef = useRef<DrawingEditorHandle>(null);
  const pendingRef = useRef<DrawingDocument | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useUnsavedGuard(dirty);

  useEffect(() => {
    let active = true;
    void drawingLocalRepository
      .get(localId)
      .then((drawing) => {
        if (!active) return;
        setLoad(drawing ? { kind: "ready", drawing } : { kind: "missing" });
      })
      .catch(() => active && setLoad({ kind: "error" }));
    return () => {
      active = false;
    };
  }, [attempt, localId]);

  usePageMeta({
    title: load.kind === "ready" ? load.drawing.title : "Whiteboard",
    noindex: true,
  });

  function queueSave(document: DrawingDocument, immediate = false): void {
    pendingRef.current = document;
    setDirty(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = immediate
      ? null
      : window.setTimeout(() => {
          timerRef.current = null;
          void savePending();
        }, 250);
    if (immediate) void savePending().catch(() => undefined);
  }

  async function savePending(): Promise<void> {
    if (inFlightRef.current) {
      await inFlightRef.current;
      if (pendingRef.current) await savePending();
      return;
    }
    const document = pendingRef.current;
    if (!document || load.kind !== "ready") {
      if (!pendingRef.current) setDirty(false);
      return;
    }
    pendingRef.current = null;
    setSaving(true);
    const task = (async () => {
      const thumbnail = await editorRef.current?.export({
        format: "png",
        bounds: "content",
        padding: 24,
        scale: 1,
      });
      await drawingLocalRepository.save({
        id: localId,
        title: load.drawing.title,
        document,
        thumbnail,
      });
      if (!pendingRef.current) setDirty(false);
    })().catch(() => {
      pendingRef.current = document;
      setError(
        "Could not save to this browser. Keep this tab open and try again.",
      );
      throw new Error("local_save_failed");
    });
    inFlightRef.current = task;
    try {
      await task;
    } finally {
      inFlightRef.current = null;
      setSaving(false);
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

  async function saveToAccount(): Promise<void> {
    if (load.kind !== "ready") return;
    setError(null);
    const signedIn =
      status === "authenticated" ||
      (await openAuthModal({ reason: "save", tab: "signup" }));
    if (!signedIn) return;
    setSaving(true);
    try {
      await editorRef.current?.saveNow();
      const current = await drawingLocalRepository.get(localId);
      const drawing = await drawingsApi.create({
        title: load.drawing.title,
        document:
          editorRef.current?.getDocument() ??
          current?.document ??
          load.drawing.document,
      });
      if (current?.thumbnail) {
        try {
          await drawingsApi.uploadThumbnail(drawing.id, current.thumbnail);
        } catch {
          // The board has already been migrated; a missing thumbnail is safe to repair on the next save.
        }
      }
      await drawingLocalRepository.remove(localId);
      navigate("/drawings/" + drawing.id, { replace: true });
    } catch (cause) {
      setError(
        isApiError(cause)
          ? cause.message
          : "Could not save this whiteboard to your account yet.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function renameDrawing(nextTitle: string): Promise<void> {
    if (load.kind !== "ready") return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await savePending();
    const current = await drawingLocalRepository.get(localId);
    const saved = await drawingLocalRepository.save({
      id: localId,
      title: nextTitle,
      document:
        editorRef.current?.getDocument() ??
        current?.document ??
        load.drawing.document,
      thumbnail: current?.thumbnail,
    });
    setLoad({ kind: "ready", drawing: saved });
  }

  async function startCollaboration(): Promise<void> {
    if (load.kind !== "ready") return;
    setError(null);
    setSaving(true);
    try {
      await editorRef.current?.saveNow();
      const room = await drawingRoomsApi.create({
        title: load.drawing.title,
        document: editorRef.current?.getDocument() ?? load.drawing.document,
      });
      if (!room.key || !room.owner_key || !room.view_key)
        throw new Error("missing_room_credentials");
      sessionStorage.setItem(drawingRoomEditStorageKey(room.id), room.key);
      sessionStorage.setItem(
        drawingRoomOwnerStorageKey(room.id),
        room.owner_key,
      );
      sessionStorage.setItem(drawingRoomViewStorageKey(room.id), room.view_key);
      navigate("/drawings/room" + drawingRoomHash(room.id, room.key), {
        replace: true,
      });
    } catch (cause) {
      setError(
        isApiError(cause)
          ? cause.message
          : "Could not start a collaboration room yet.",
      );
    } finally {
      setSaving(false);
    }
  }

  function openCollaboration(): void {
    if (saving) return;
    setError(null);
    setCollaborationOpen(true);
  }

  if (load.kind === "loading")
    return <EditorSkeleton label="Opening your whiteboard" />;
  if (load.kind === "missing")
    return <EditorProblemPage problem="local-missing" />;
  if (load.kind === "error")
    return (
      <EditorProblemPage
        problem="error"
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );

  return (
    <div className={styles.page}>
      {error && !collaborationOpen ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <div className={styles.accountBar}>
        <span>{saving ? "Saving…" : "Stored in this browser"}</span>
        <Button
          size="sm"
          variant="secondary"
          loading={saving}
          onClick={openCollaboration}
        >
          Collaborate
        </Button>
      </div>
      <DrawingEditor
        ref={editorRef}
        initialDocument={load.drawing.document}
        title={load.drawing.title}
        onSaveToAccount={() => void saveToAccount()}
        onTitleChange={renameDrawing}
        onDocumentChange={(document) => queueSave(document)}
        onSaveNow={async (document) => {
          queueSave(document, true);
          await savePending();
        }}
      />
      <Dialog
        open={collaborationOpen}
        onClose={() => setCollaborationOpen(false)}
        title="Start a live room"
        description="Invite people to draw with you in real time. No sign-in is required to join."
        size="sm"
        dismissible={!saving}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setCollaborationOpen(false)}
            >
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void startCollaboration()}>
              Start live room
            </Button>
          </>
        }
      >
        <div className={styles.collaborationDialog}>
          {error ? (
            <p className={styles.dialogError} role="alert">
              {error}
            </p>
          ) : null}
          <ul className={styles.collaborationOptions}>
            <li>
              <strong>Edit link</strong>
              <span>
                People with this link can draw and make changes together.
              </span>
            </li>
            <li>
              <strong>View-only link</strong>
              <span>
                Share a read-only link when someone only needs to follow along.
              </span>
            </li>
            <li>
              <strong>You stay in control</strong>
              <span>
                Rotate links or end the room at any time from the room controls.
              </span>
            </li>
          </ul>
          {saving ? (
            <p className={styles.collaborationProgress} role="status">
              Saving your latest changes and opening the room…
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
