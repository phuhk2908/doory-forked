import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DrawingEditor,
  type DrawingEditorHandle,
} from "@/drawing/DrawingEditor";
import { colorCollaborators } from "@/drawing/collaboratorColors";
import { mergeDrawingDocuments, type DrawingDocument } from "@/drawing/model";
import {
  drawingRoomDisplayName,
  drawingRoomHash,
  drawingRoomOwnerStorageKey,
  parseDrawingRoomHash,
  type DrawingRoomLink,
} from "@/drawing/roomLink";
import {
  useDrawingRoomRealtime,
  type DrawingRoomPeer,
} from "@/drawing/roomRealtime";
import { useDrawingSession } from "@/drawing/session";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAuthModal } from "@/features/auth/AuthModalProvider";
import { drawingRoomsApi, drawingsApi, isApiError } from "@/lib/api";
import type { DrawingRoom, DrawingRoomCollaborator } from "@/types/api";
import { Button, ConfirmDialog, Dialog, Input, Select } from "@/ui";
import {
  EditorProblemPage,
  EditorSkeleton,
} from "@/features/editor/EditorStates";
import { usePageMeta } from "@/lib/usePageMeta";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import styles from "./DrawingPage.module.css";

type LoadedRoom = DrawingRoom & { key: string };
type CollaboratorRole = "view" | "edit";
type RoomLinkMode = "view" | "edit";
type Load =
  | { kind: "loading" }
  | { kind: "ready"; room: LoadedRoom }
  | { kind: "missing" | "not-found" }
  | { kind: "offline" }
  | { kind: "error" };

function problemFor(error: unknown): "offline" | "not-found" | "error" {
  if (isApiError(error)) {
    if (error.isNetwork) return "offline";
    if (error.status === 404) return "not-found";
  }
  return "error";
}

function readSession(key: string): string | null {
  try {
    return typeof window === "undefined"
      ? null
      : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function roomUrl(id: string, key: string): string {
  return window.location.origin + "/drawings/room" + drawingRoomHash(id, key);
}

function replaceRoomHash(hash: string): void {
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search + hash,
  );
}

export default function DrawingRoomPage() {
  const [link, setLink] = useState<DrawingRoomLink | null>(() =>
    parseDrawingRoomHash(
      typeof window === "undefined" ? "" : window.location.hash,
    ),
  );
  const navigate = useNavigate();
  const { status } = useAuth();
  const { openAuthModal } = useAuthModal();
  const editorRef = useRef<DrawingEditorHandle>(null);
  const revisionRef = useRef(1);
  const [load, setLoad] = useState<Load>({
    kind: link ? "loading" : "missing",
  });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [ended, setEnded] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [linkMode, setLinkMode] = useState<RoomLinkMode>("edit");
  const [peers, setPeers] = useState<DrawingRoomPeer[]>([]);
  const peerColorsRef = useRef(new Map<string, string>());
  const [accountOwned, setAccountOwned] = useState<boolean | null>(null);
  const [collaborators, setCollaborators] = useState<DrawingRoomCollaborator[]>(
    [],
  );
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [collaboratorRole, setCollaboratorRole] =
    useState<CollaboratorRole>("edit");
  const [collaboratorBusy, setCollaboratorBusy] = useState(false);
  const [collaboratorError, setCollaboratorError] = useState<string | null>(
    null,
  );
  const [transferEmail, setTransferEmail] = useState("");
  const [transferConfirm, setTransferConfirm] = useState(false);
  const [ownerKey, setOwnerKey] = useState<string | null>(() =>
    link ? readSession(drawingRoomOwnerStorageKey(link.id)) : null,
  );
  const activeRoomKeyRef = useRef(link?.key ?? null);
  const rotationPendingRef = useRef(false);
  const peerColors = useMemo(
    () =>
      colorCollaborators(
        peers.map((peer) => peer.id),
        peerColorsRef.current,
      ),
    [peers],
  );
  const realtimeRef = useRef<{
    publish(document: DrawingDocument): Promise<void>;
  } | null>(null);
  const session = useDrawingSession({
    delayMs: 0,
    canSave: () => load.kind === "ready" && canEdit && !ended,
    save: (document) =>
      realtimeRef.current?.publish(document) ?? Promise.resolve(),
    onError: () => {
      if (!ended)
        setError("Could not save yet. Your changes are still on this page.");
    },
  });
  useUnsavedGuard(session.dirty && canEdit && !ended);

  useEffect(() => {
    if (!link) return undefined;
    let active = true;
    void drawingRoomsApi
      .get(link.id, link.key)
      .then((room) => {
        if (!active) return;
        revisionRef.current = room.revision;
        const mode = room.mode === "view" ? "view" : "edit";
        setLinkMode(mode);
        setCanEdit(mode === "edit");
        setLoad({ kind: "ready", room: { ...room, key: link.key } });
      })
      .catch((cause) => {
        if (active) setLoad({ kind: problemFor(cause) });
      });
    return () => {
      active = false;
    };
  }, [attempt, link]);

  useEffect(() => {
    if (!shareOpen || status !== "authenticated" || !link) return undefined;
    let active = true;
    setAccountOwned(null);
    setCollaboratorError(null);
    void drawingRoomsApi
      .listCollaborators(link.id)
      .then((items) => {
        if (!active) return;
        setAccountOwned(true);
        setCollaborators(items);
      })
      .catch((cause) => {
        if (!active) return;
        if (isApiError(cause) && cause.status === 404) {
          setAccountOwned(false);
          setCollaborators([]);
          return;
        }
        setCollaboratorError(
          isApiError(cause)
            ? cause.message
            : "Could not load named collaborators yet.",
        );
      });
    return () => {
      active = false;
    };
  }, [link, shareOpen, status]);

  usePageMeta({
    title:
      load.kind === "ready"
        ? drawingRoomDisplayName(load.room.title)
        : "Whiteboard",
    noindex: true,
  });

  function acceptRemote(document: DrawingDocument, revision: number): void {
    if (revision <= revisionRef.current || ended) return;
    const current = editorRef.current?.getDocument();
    const merged = current
      ? mergeDrawingDocuments(current, document)
      : document;
    editorRef.current?.applyRemoteDocument(merged);
    revisionRef.current = revision;
    session.markSaved();
  }

  const realtime = useDrawingRoomRealtime({
    roomId: load.kind === "ready" ? load.room.id : "",
    key: load.kind === "ready" ? load.room.key : "",
    enabled: load.kind === "ready" && !ended,
    onDocument: acceptRemote,
    onSaved: (document, revision) => {
      revisionRef.current = Math.max(revisionRef.current, revision);
      const current = editorRef.current?.getDocument();
      const merged = current
        ? mergeDrawingDocuments(current, document)
        : document;
      if (current && JSON.stringify(merged) !== JSON.stringify(current))
        editorRef.current?.applyRemoteDocument(merged);
      session.markSaved();
    },
    onPresence: () => undefined,
    onPeers: setPeers,
    onTitle: (title) => {
      setLoad((value) =>
        value.kind === "ready"
          ? { ...value, room: { ...value.room, title } }
          : value,
      );
    },
    onAccess: (mode, editable) => {
      setLinkMode(mode);
      setCanEdit(editable && mode === "edit");
    },
    onClosed: (reason, closedKey) => {
      if (closedKey !== activeRoomKeyRef.current) return;
      if (reason === "revoked" && rotationPendingRef.current) return;
      setEnded(true);
      setCanEdit(false);
      setOwnerKey(null);
      if (link) {
        sessionStorage.removeItem(drawingRoomOwnerStorageKey(link.id));
      }
      replaceRoomHash("");
      setError(
        "This room has ended. You can still export the board or save a copy to your account.",
      );
    },
    onError: (message) => setError(message),
  });
  realtimeRef.current = realtime;

  async function copyText(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError(
        "Could not copy the link. Copy it from the address bar instead.",
      );
    }
  }

  async function manageRoom(
    action: "access" | "close" | "rotate" | "rename",
    value?: string,
  ): Promise<void> {
    if (!link || !ownerKey || manageBusy) return;
    if (action === "rotate") rotationPendingRef.current = true;
    setManageBusy(true);
    setError(null);
    try {
      const result = await drawingRoomsApi.manage(
        link.id,
        ownerKey,
        action,
        value,
      );
      if (action === "close") {
        setEnded(true);
        setCanEdit(false);
        setOwnerKey(null);
        sessionStorage.removeItem(drawingRoomOwnerStorageKey(link.id));
        replaceRoomHash("");
        setShareOpen(false);
        setConfirmEnd(false);
        return;
      }
      if (action === "rename") {
        setLoad((value) =>
          value.kind === "ready"
            ? { ...value, room: { ...value.room, title: result.title } }
            : value,
        );
        return;
      }
      if (action === "access") {
        const mode = result.mode === "view" ? "view" : "edit";
        setLinkMode(mode);
        setCanEdit(mode === "edit");
        return;
      }
      if (!result.key) throw new Error("missing_rotated_keys");
      const rotatedKey = result.key;
      const nextLink: DrawingRoomLink = {
        ...link,
        key: rotatedKey,
        mode: result.mode === "view" ? "view" : "edit",
      };
      activeRoomKeyRef.current = nextLink.key;
      rotationPendingRef.current = false;
      setLink(nextLink);
      setEnded(false);
      setLinkMode(nextLink.mode);
      setCanEdit(nextLink.mode === "edit");
      setLoad((value) =>
        value.kind === "ready"
          ? { ...value, room: { ...value.room, ...result, key: rotatedKey } }
          : value,
      );
      replaceRoomHash(drawingRoomHash(nextLink.id, rotatedKey));
    } catch (cause) {
      if (action === "rotate") rotationPendingRef.current = false;
      setError(
        isApiError(cause) ? cause.message : "Could not update this room yet.",
      );
    } finally {
      setManageBusy(false);
    }
  }

  async function addCollaborator(): Promise<void> {
    if (!link || !collaboratorEmail.trim()) return;
    setCollaboratorBusy(true);
    setCollaboratorError(null);
    try {
      const collaborator = await drawingRoomsApi.addCollaborator(
        link.id,
        collaboratorEmail.trim(),
        collaboratorRole,
      );
      setCollaborators((current) => [
        ...current.filter((item) => item.user_id !== collaborator.user_id),
        collaborator,
      ]);
      setCollaboratorEmail("");
    } catch (cause) {
      setCollaboratorError(
        isApiError(cause)
          ? cause.message
          : "Could not add this collaborator yet.",
      );
    } finally {
      setCollaboratorBusy(false);
    }
  }

  async function updateCollaborator(
    collaborator: DrawingRoomCollaborator,
    role: CollaboratorRole,
  ): Promise<void> {
    if (!link) return;
    setCollaboratorBusy(true);
    setCollaboratorError(null);
    try {
      const updated = await drawingRoomsApi.updateCollaborator(
        link.id,
        collaborator.user_id,
        role,
      );
      setCollaborators((current) =>
        current.map((item) =>
          item.user_id === updated.user_id ? updated : item,
        ),
      );
    } catch (cause) {
      setCollaboratorError(
        isApiError(cause)
          ? cause.message
          : "Could not update this collaborator yet.",
      );
    } finally {
      setCollaboratorBusy(false);
    }
  }

  async function removeCollaborator(
    collaborator: DrawingRoomCollaborator,
  ): Promise<void> {
    if (!link) return;
    setCollaboratorBusy(true);
    setCollaboratorError(null);
    try {
      await drawingRoomsApi.removeCollaborator(link.id, collaborator.user_id);
      setCollaborators((current) =>
        current.filter((item) => item.user_id !== collaborator.user_id),
      );
    } catch (cause) {
      setCollaboratorError(
        isApiError(cause)
          ? cause.message
          : "Could not remove this collaborator yet.",
      );
    } finally {
      setCollaboratorBusy(false);
    }
  }

  async function transferOwnership(): Promise<void> {
    if (!link || !transferEmail.trim()) return;
    setCollaboratorBusy(true);
    setCollaboratorError(null);
    try {
      await drawingRoomsApi.transferOwnership(link.id, transferEmail.trim());
      sessionStorage.removeItem(drawingRoomOwnerStorageKey(link.id));
      setOwnerKey(null);
      setTransferConfirm(false);
      setShareOpen(false);
    } catch (cause) {
      setCollaboratorError(
        isApiError(cause) ? cause.message : "Could not transfer ownership yet.",
      );
      setTransferConfirm(false);
    } finally {
      setCollaboratorBusy(false);
    }
  }

  async function saveToAccount(): Promise<void> {
    if (load.kind !== "ready") return;
    setError(null);
    const signedIn =
      status === "authenticated" ||
      (await openAuthModal({ reason: "save", tab: "signup" }));
    if (!signedIn) return;
    setSavingAccount(true);
    try {
      const document = editorRef.current?.getDocument() ?? load.room.document;
      const drawing = await drawingsApi.create({
        title: load.room.title,
        document,
      });
      try {
        const thumbnail = await editorRef.current?.export({
          format: "png",
          bounds: "content",
          padding: 24,
          scale: 1,
        });
        if (thumbnail) await drawingsApi.uploadThumbnail(drawing.id, thumbnail);
      } catch {
        // The document is already in the account; a thumbnail can be repaired on a later save.
      }
      navigate("/drawings/" + drawing.id, { replace: true });
    } catch (cause) {
      setError(
        isApiError(cause)
          ? cause.message
          : "Could not save a copy to your account yet.",
      );
    } finally {
      setSavingAccount(false);
    }
  }

  if (load.kind === "loading")
    return <EditorSkeleton label="Opening the collaboration room" />;
  if (load.kind === "missing" || load.kind === "not-found")
    return <EditorProblemPage problem="not-found" />;
  if (load.kind === "offline")
    return (
      <EditorProblemPage
        problem="offline"
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  if (load.kind === "error")
    return (
      <EditorProblemPage
        problem="error"
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  if (load.kind !== "ready" || !link) return null;

  const roomName = drawingRoomDisplayName(load.room.title);
  const currentLink = roomUrl(load.room.id, link.key);
  const isReadOnly = ended || !canEdit;
  const statusLabel =
    ended || realtime.status === "closed"
      ? "Room ended"
      : !canEdit
        ? "View only"
        : realtime.status === "live"
          ? realtime.peerCount > 1
            ? "Live · " +
              (realtime.peerCount - 1) +
              " other" +
              (realtime.peerCount === 2 ? "" : "s")
            : "Live room"
          : realtime.status === "connecting"
            ? "Connecting…"
            : "Offline · reconnecting";

  return (
    <div className={styles.page}>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <div className={styles.accountBar} aria-live="polite">
        <span>{statusLabel}</span>
        {!canEdit && !ended ? (
          <span className={styles.roomBadge}>View only</span>
        ) : null}
        {!ended ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void copyText(currentLink, "current")}
            >
              {copied === "current" ? "Copied" : "Copy link"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShareOpen(true)}
            >
              Share
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          loading={savingAccount}
          onClick={() => void saveToAccount()}
        >
          Save to account
        </Button>
      </div>
      <DrawingEditor
        ref={editorRef}
        initialDocument={load.room.document}
        title={load.room.title}
        onTitleChange={
          ownerKey ? (title) => manageRoom("rename", title) : undefined
        }
        readOnly={isReadOnly}
        remotePeers={peers.map((peer) => ({
          ...peer,
          color: peerColors.get(peer.id),
        }))}
        onPresenceChange={(presence) => realtime.publishPresence(presence)}
        onSaveNow={session.saveNow}
        onDocumentChange={(document) => {
          if (!canEdit || ended) return;
          setError(null);
          session.queue(document);
        }}
      />
      <Dialog
        open={shareOpen}
        onClose={() => {
          setShareOpen(false);
          setCollaboratorError(null);
        }}
        title={`Share “${roomName}”`}
        description={
          ownerKey
            ? "Anyone with this link can edit or view this board."
            : "Anyone with this link can open the room."
        }
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setShareOpen(false)}>
            Done
          </Button>
        }
      >
        <div className={styles.shareDialog}>
          <div className={styles.shareRow}>
            <Input
              label="Room link"
              value={currentLink}
              readOnly
              inputSize="sm"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void copyText(currentLink, "current-dialog")}
            >
              {copied === "current-dialog" ? "Copied" : "Copy"}
            </Button>
          </div>
          <section className={styles.linkAccessSection}>
            <div>
              <h3>Link access</h3>
              <p className={styles.collaboratorHint}>
                This link is currently{" "}
                {linkMode === "edit" ? "editable" : "view only"}. Changing it
                updates the same link for everyone after they refresh.
              </p>
            </div>
            {ownerKey ? (
              <Select
                label="Permission"
                value={linkMode}
                onChange={(event) =>
                  void manageRoom("access", event.target.value)
                }
                options={[
                  { value: "edit", label: "Can edit" },
                  { value: "view", label: "Can view" },
                ]}
                selectSize="sm"
                disabled={manageBusy}
              />
            ) : null}
          </section>
          {status === "authenticated" && accountOwned ? (
            <section className={styles.collaboratorSection}>
              <div>
                <h3>Named collaborators</h3>
                <p className={styles.collaboratorHint}>
                  Add signed-in accounts by email. Their names appear in the
                  live room; link access remains unchanged.
                </p>
              </div>
              {collaboratorError ? (
                <p className={styles.dialogError} role="alert">
                  {collaboratorError}
                </p>
              ) : null}
              <div className={styles.collaboratorForm}>
                <Input
                  label="Account email"
                  value={collaboratorEmail}
                  onChange={(event) => setCollaboratorEmail(event.target.value)}
                  inputSize="sm"
                  type="email"
                  autoComplete="email"
                />
                <Select
                  label="Access"
                  value={collaboratorRole}
                  onChange={(event) =>
                    setCollaboratorRole(event.target.value as CollaboratorRole)
                  }
                  options={[
                    { value: "edit", label: "Can edit" },
                    { value: "view", label: "Can view" },
                  ]}
                  selectSize="sm"
                />
                <Button
                  size="sm"
                  onClick={() => void addCollaborator()}
                  loading={collaboratorBusy}
                  disabled={!collaboratorEmail.trim()}
                >
                  Add
                </Button>
              </div>
              {collaborators.length ? (
                <ul className={styles.collaboratorList}>
                  {collaborators.map((collaborator) => (
                    <li key={collaborator.user_id}>
                      <div className={styles.collaboratorIdentity}>
                        <strong>{collaborator.name}</strong>
                        <span>{collaborator.email}</span>
                      </div>
                      <Select
                        label={`Access for ${collaborator.name}`}
                        hideLabel
                        value={collaborator.role}
                        onChange={(event) =>
                          void updateCollaborator(
                            collaborator,
                            event.target.value as CollaboratorRole,
                          )
                        }
                        options={[
                          { value: "edit", label: "Can edit" },
                          { value: "view", label: "Can view" },
                        ]}
                        selectSize="sm"
                        disabled={collaboratorBusy}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={collaboratorBusy}
                        onClick={() => void removeCollaborator(collaborator)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.collaboratorHint}>
                  No named collaborators yet.
                </p>
              )}
              <div className={styles.transferSection}>
                <div>
                  <h3>Transfer ownership</h3>
                  <p className={styles.collaboratorHint}>
                    The new owner will manage this room. Your browser owner link
                    will be revoked.
                  </p>
                </div>
                <div className={styles.shareRow}>
                  <Input
                    label="New owner email"
                    value={transferEmail}
                    onChange={(event) => setTransferEmail(event.target.value)}
                    inputSize="sm"
                    type="email"
                    autoComplete="email"
                  />
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!transferEmail.trim() || collaboratorBusy}
                    onClick={() => setTransferConfirm(true)}
                  >
                    Transfer
                  </Button>
                </div>
              </div>
            </section>
          ) : null}
          {ownerKey ? (
            <div className={styles.shareActions}>
              <Button
                size="sm"
                variant="secondary"
                loading={manageBusy}
                onClick={() => void manageRoom("rotate")}
              >
                Rotate link
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={manageBusy || ended}
                onClick={() => setConfirmEnd(true)}
              >
                End room
              </Button>
            </div>
          ) : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmEnd}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => manageRoom("close")}
        title="End this room?"
        description="Everyone with the current link will lose access. The room cannot be reopened."
        confirmLabel="End room"
        cancelLabel="Keep room open"
        tone="danger"
        loading={manageBusy}
      />
      <ConfirmDialog
        open={transferConfirm}
        onCancel={() => setTransferConfirm(false)}
        onConfirm={transferOwnership}
        title="Transfer room ownership?"
        description={`Transfer this room to ${transferEmail.trim()}? Your current browser owner link will stop working.`}
        confirmLabel="Transfer ownership"
        cancelLabel="Keep ownership"
        tone="danger"
        loading={collaboratorBusy}
      />
    </div>
  );
}
