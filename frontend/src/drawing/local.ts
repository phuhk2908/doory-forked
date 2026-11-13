import { blankDrawing, restoreDrawing, type DrawingDocument } from "./model";
import { uuid } from "../lib/uuid";

export interface LocalDrawing {
  id: string;
  title: string;
  document: DrawingDocument;
  thumbnail?: Blob;
  createdAt: number;
  updatedAt: number;
}

export interface DrawingStore {
  get(id: string): Promise<LocalDrawing | undefined>;
  list(): Promise<LocalDrawing[]>;
  put(drawing: LocalDrawing): Promise<void>;
  delete(id: string): Promise<void>;
}

type DrawingStoreOpener = () => Promise<DrawingStore>;

function newId(): string {
  return uuid();
}

function request<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new DOMException("Transaction aborted", "AbortError"),
      );
  });
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("doory-drawings", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("drawings"))
        request.result.createObjectStore("drawings", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new DOMException("Database blocked", "InvalidStateError"));
  });
}

function memoryStore(): DrawingStore {
  const drawings = new Map<string, LocalDrawing>();
  return {
    get: async (id) => drawings.get(id),
    list: async () => [...drawings.values()],
    put: async (drawing) => {
      drawings.set(drawing.id, drawing);
    },
    delete: async (id) => {
      drawings.delete(id);
    },
  };
}

async function browserStore(): Promise<DrawingStore> {
  if (typeof indexedDB === "undefined") return memoryStore();
  const db = await openIndexedDb();
  db.onversionchange = () => db.close();
  return {
    get: (id) =>
      request<LocalDrawing | undefined>(
        db.transaction("drawings", "readonly").objectStore("drawings").get(id),
      ),
    list: () =>
      request<LocalDrawing[]>(
        db.transaction("drawings", "readonly").objectStore("drawings").getAll(),
      ),
    put: async (drawing) => {
      const transaction = db.transaction("drawings", "readwrite");
      transaction.objectStore("drawings").put(drawing);
      await transactionDone(transaction);
    },
    delete: async (id) => {
      const transaction = db.transaction("drawings", "readwrite");
      transaction.objectStore("drawings").delete(id);
      await transactionDone(transaction);
    },
  };
}

export class DrawingLocalRepository {
  private storePromise: Promise<DrawingStore> | null = null;

  constructor(private readonly openStore: DrawingStoreOpener = browserStore) {}

  private store(): Promise<DrawingStore> {
    if (this.storePromise === null) {
      this.storePromise = this.openStore().catch((error: unknown) => {
        // A blocked or temporarily unavailable database must not poison Retry forever.
        this.storePromise = null;
        throw error;
      });
    }
    return this.storePromise;
  }

  private async withStore<T>(
    operation: (store: DrawingStore) => Promise<T>,
  ): Promise<T> {
    const store = await this.store();
    try {
      return await operation(store);
    } catch (error) {
      // A database can close after opening (for example after a version change).
      // Drop the cached handle so the next retry reopens it.
      this.storePromise = null;
      throw error;
    }
  }

  async create(title = "Untitled whiteboard"): Promise<LocalDrawing> {
    const now = Date.now();
    const drawing: LocalDrawing = {
      id: newId(),
      title,
      document: blankDrawing(),
      createdAt: now,
      updatedAt: now,
    };
    await this.save(drawing);
    return drawing;
  }

  async get(id: string): Promise<LocalDrawing | null> {
    return (await this.withStore((store) => store.get(id))) ?? null;
  }

  async list(): Promise<LocalDrawing[]> {
    return (await this.withStore((store) => store.list())).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  async save(input: {
    id: string;
    title: string;
    document: DrawingDocument;
    thumbnail?: Blob;
  }): Promise<LocalDrawing> {
    return this.withStore(async (store) => {
      const previous = await store.get(input.id);
      const drawing: LocalDrawing = {
        id: input.id,
        title: input.title,
        document: restoreDrawing(input.document),
        thumbnail: input.thumbnail ?? previous?.thumbnail,
        createdAt: previous?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      await store.put(drawing);
      return drawing;
    });
  }

  async remove(id: string): Promise<void> {
    await this.withStore((store) => store.delete(id));
  }
}

export const drawingLocalRepository = new DrawingLocalRepository();
