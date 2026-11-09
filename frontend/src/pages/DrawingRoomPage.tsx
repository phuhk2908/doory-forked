import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DrawingEditor,
  type DrawingEditorHandle,
} from "@/drawing/DrawingEditor";
import { mergeDrawingDocuments, type DrawingDocument } from "@/drawing/model";
import {
  drawingRoomEditStorageKey,
  drawingRoomHash,
  drawingRoomOwnerStorageKey,
  drawingRoomViewStorageKey,
  parseDrawingRoomHash,
} from "@/drawing/roomLink";
import {
  useDrawingRoomRealtime,
  type DrawingRoomPeer,
} from "@/drawing/roomRealtime";
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

function roomUrl(id: string, key: string, mode: "edit" | "view"): string {
  return (
    window.location.origin + "/drawings/room" + drawingRoomHash(id, key, mode)
  );
}

export default function DrawingRoomPage() {
  const link = useMemo(
    () =>
      parseDrawingRoomHash(
        typeof window === "undefined" ? "" : window.location.hash,
      ),
    [],
  );
  const navigate = useNavigate();
  const { status } = useAuth();
  const { openAuthModal } = useAuthModal();
  const editorRef = useRef<DrawingEditorHandle>(null);
  const revisionRef = useRef(1);
  const [load, setLoad] = useState<Load>({
    kind: link ? "loading" : "missing",
  });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [ended, setEnded] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [peers, setPeers] = useState<DrawingRoomPeer[]>([]);
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
  const ownerKey = useMemo(
    () => (link ? readSession(drawingRoomOwnerStorageKey(link.id)) : null),
    [link],
  );
  const storedEditKey = useMemo(
    () => (link ? readSession(drawingRoomEditStorageKey(link.id)) : null),
    [link],
  );
  const storedViewKey = useMemo(
    () => (link ? readSession(drawingRoomViewStorageKey(link.id)) : null),
    [link],
  );
  useUnsavedGuard(dirty && canEdit && !ended);

  useEffect(() => {
    if (!link) return undefined;
    let active = true;
    void drawingRoomsApi
      .get(link.id, link.key)
      .then((room) => {
        if (!active) return;
        revisionRef.current = room.revision;
        setCanEdit(room.mode === "edit");
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
    title: load.kind === "ready" ? load.room.title : "Whiteboard",
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
    setDirty(false);
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
      setDirty(false);
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
      setCanEdit(editable && mode === "edit");
    },
    onClosed: () => {
      setEnded(true);
      setCanEdit(false);
      setError(
        "This room has ended. You can still export the board or save a copy to your account.",
      );
    },
    onError: (message) => setError(message),
  });

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
    action: "close" | "rotate" | "rename",
    title?: string,
  ): Promise<void> {
    if (!link || !ownerKey) return;
    setManageBusy(true);
    setError(null);
    try {
      const result = await drawingRoomsApi.manage(
        link.id,
        ownerKey,
        action,
        title,
      );
      if (action === "close") {
        setEnded(true);
        setCanEdit(false);
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
      if (!result.key || !result.view_key)
        throw new Error("missing_rotated_keys");
      sessionStorage.setItem(drawingRoomEditStorageKey(link.id), result.key);
      sessionStorage.setItem(
        drawingRoomViewStorageKey(link.id),
        result.view_key,
      );
      window.location.assign(
        "/drawings/room" + drawingRoomHash(link.id, result.key, "edit"),
      );
    } catch (cause) {
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
      if (ownerKey) {
        sessionStorage.removeItem(drawingRoomOwnerStorageKey(link.id));
      }
      setTransferConfirm(false);
      window.location.reload();
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

  const editKey = link.mode === "edit" ? link.key : storedEditKey;
  const viewKey = storedViewKey ?? (link.mode === "view" ? link.key : null);
  const currentLink = window.location.href;
  const editLink = editKey ? roomUrl(load.room.id, editKey, "edit") : null;
  const viewLink = viewKey ? roomUrl(load.room.id, viewKey, "view") : null;
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
        remotePeers={peers.map((peer, index) => ({
          ...peer,
          color: ["#f97316", "#8b5cf6", "#0891b2", "#16a34a"][index % 4],
        }))}
        onPresenceChange={(presence) => realtime.publishPresence(presence)}
        onDocumentChange={(document) => {
          if (!canEdit || ended) return;
          setDirty(true);
          setError(null);
          realtime.publish(document);
        }}
      />
      <Dialog
        open={shareOpen}
        onClose={() => {
          setShareOpen(false);
          setCollaboratorError(null);
        }}
        title="Share this room"
        description={
          ownerKey
            ? "Choose whether people can edit or view this board."
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
              label="Current link"
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
          {editLink ? (
            <div className={styles.shareRow}>
              <Input
                label="Can edit"
                value={editLink}
                readOnly
                inputSize="sm"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void copyText(editLink, "edit")}
              >
                {copied === "edit" ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : null}
          {viewLink ? (
            <div className={styles.shareRow}>
              <Input
                label="View only"
                value={viewLink}
                readOnly
                inputSize="sm"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void copyText(viewLink, "view")}
              >
                {copied === "view" ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : null}
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
                Rotate links
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
        description="Everyone with the current links will lose access. The room cannot be reopened."
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
