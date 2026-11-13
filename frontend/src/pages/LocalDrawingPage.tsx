import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DrawingEditor,
  type DrawingEditorHandle,
} from "@/drawing/DrawingEditor";
import {
  hasLocalDrawingImages,
  localDrawingAssetIds,
  migrateLocalDrawingFiles,
  resolveDrawingImage,
  storeLocalDrawingImage,
} from "@/drawing/imageAssets";
import { deleteLocalAsset } from "@/lib/local";
import { drawingLocalRepository, type LocalDrawing } from "@/drawing/local";
import { useDrawingSession } from "@/drawing/session";
import {
  drawingRoomDisplayName,
  drawingRoomHash,
  drawingRoomOwnerStorageKey,
} from "@/drawing/roomLink";
import { drawingRoomsApi, drawingsApi, isApiError } from "@/lib/api";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAuthModal } from "@/features/auth/AuthModalProvider";
import { Button, Dialog } from "@/ui";
import {
  EditorProblemPage,
  EditorSkeleton,
} from "@/features/editor/EditorStates";
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
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [actionBusy, setActionBusy] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
    title:
      load.kind === "ready"
        ? drawingRoomDisplayName(load.drawing.title)
        : "Whiteboard",
    noindex: true,
  });

  const session = useDrawingSession({
    delayMs: 250,
    canSave: () => load.kind === "ready",
    save: async (document) => {
      if (load.kind !== "ready") return;
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
    },
    onError: () => {
      setError(
        "Could not save to this browser. Keep this tab open and try again.",
      );
    },
  });
  useUnsavedGuard(session.dirty);
  const saving = session.saving || actionBusy;

  async function saveToAccount(): Promise<void> {
    if (load.kind !== "ready") return;
    setError(null);
    const signedIn =
      status === "authenticated" ||
      (await openAuthModal({ reason: "save", tab: "signup" }));
    if (!signedIn) return;
    setActionBusy(true);
    try {
      await editorRef.current?.saveNow();
      const current = await drawingLocalRepository.get(localId);
      const sourceDocument =
        editorRef.current?.getDocument() ??
        current?.document ??
        load.drawing.document;
      const document = await migrateLocalDrawingFiles(sourceDocument);
      const drawing = await drawingsApi.create({
        title: load.drawing.title,
        document,
      });
      if (current?.thumbnail) {
        try {
          await drawingsApi.uploadThumbnail(drawing.id, current.thumbnail);
        } catch {
          // The board has already been migrated; a missing thumbnail is safe to repair on the next save.
        }
      }
      await drawingLocalRepository.remove(localId);
      try {
        const remaining = await drawingLocalRepository.list();
        const used = new Set(
          remaining.flatMap((item) => localDrawingAssetIds(item.document)),
        );
        await Promise.all(
          localDrawingAssetIds(sourceDocument)
            .filter((assetId) => !used.has(assetId))
            .map((assetId) => deleteLocalAsset(assetId)),
        );
      } catch {
        // Asset cleanup is best-effort; the migrated board is already safe.
      }
      navigate("/drawings/" + drawing.id, { replace: true });
    } catch (cause) {
      setError(
        isApiError(cause)
          ? cause.message
          : "Could not save this whiteboard to your account yet.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function renameDrawing(nextTitle: string): Promise<void> {
    if (load.kind !== "ready") return;
    await session.flush();
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
    setActionBusy(true);
    try {
      await editorRef.current?.saveNow();
      const sourceDocument =
        editorRef.current?.getDocument() ?? load.drawing.document;
      if (hasLocalDrawingImages(sourceDocument) && status !== "authenticated") {
        const signedIn = await openAuthModal({
          reason: "share",
          tab: "signup",
        });
        if (!signedIn) return;
      }
      const document = await migrateLocalDrawingFiles(sourceDocument);
      const room = await drawingRoomsApi.create({
        title: drawingRoomDisplayName(load.drawing.title),
        document,
      });
      if (!room.key || !room.owner_key)
        throw new Error("missing_room_credentials");
      sessionStorage.setItem(
        drawingRoomOwnerStorageKey(room.id),
        room.owner_key,
      );
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
      setActionBusy(false);
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
        onUploadImage={storeLocalDrawingImage}
        onResolveImage={resolveDrawingImage}
        onDocumentChange={(document) => session.queue(document)}
        onSaveNow={session.saveNow}
      />
      <Dialog
        open={collaborationOpen}
        onClose={() => {
          if (saving) return;
          setError(null);
          setCollaborationOpen(false);
        }}
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
              <strong>One room link</strong>
              <span>
                The same link stays valid while you choose whether guests can
                edit or view the board.
              </span>
            </li>
            <li>
              <strong>Change access anytime</strong>
              <span>
                Switch the room between Can edit and Can view without creating a
                new link.
              </span>
            </li>
            <li>
              <strong>You stay in control</strong>
              <span>
                Rotate the link or end the room at any time from the room
                controls.
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
