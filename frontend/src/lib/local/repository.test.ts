import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { IDBFactory } from "fake-indexeddb";
import { createBlankDocument } from "@/lib/document";
import { LocalRepository, openBrowserStore } from "./repository";
import { LocalStorageError, LocalStorageFullError } from "./types";
import { createMemoryStore, type LocalStore } from "./store";

/** jsdom's Blob does not survive Node's structuredClone (used by fake-indexeddb); real browsers clone Blobs natively. */
const blob = (parts: string[], type = ""): Blob =>
  new NodeBlob(parts, { type }) as unknown as Blob;

const ASSET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function docWithImages(...ids: string[]) {
  const doc = createBlankDocument(400, 300);
  doc.pages[0].objects = ids.map((id, index) => ({
    id: `o${index}`,
    type: "image",
    src: `idb://${id}`,
  }));
  return doc;
}

function freshRepository() {
  globalThis.indexedDB = new IDBFactory();
  return new LocalRepository();
}

describe("LocalRepository designs", () => {
  it("creates, lists (newest first), reads and deletes designs", async () => {
    const repo = freshRepository();
    const first = await repo.createDesign({
      title: "First",
      document: createBlankDocument(100, 100),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await repo.createDesign({
      title: "Second",
      document: createBlankDocument(200, 100),
    });
    const list = await repo.listDesigns();
    expect(list.map((d) => d.title)).toEqual(["Second", "First"]);
    expect(list[0]).toMatchObject({ width: 200, height: 100, pageCount: 1 });
    expect((await repo.getDesign(first.id))?.title).toBe("First");
    await repo.deleteDesign(first.id);
    expect(await repo.getDesign(first.id)).toBeNull();
    expect(await repo.listDesigns()).toHaveLength(1);
    expect(second.id).not.toBe(first.id);
  });

  it("upserts while preserving createdAt and the previous thumbnail", async () => {
    const repo = freshRepository();
    const created = await repo.saveDesign({
      id: "d1",
      title: "v1",
      document: createBlankDocument(10, 10),
      thumbnail: blob(["png"], "image/png"),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const saved = await repo.saveDesign({
      id: "d1",
      title: "v2",
      document: createBlankDocument(10, 10),
    });
    expect(saved.createdAt).toBe(created.createdAt);
    expect(saved.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(saved.thumbnail).toBeDefined();
    expect((await repo.getDesign("d1"))?.title).toBe("v2");
  });

  it("returns null for unknown designs", async () => {
    expect(await freshRepository().getDesign("missing")).toBeNull();
  });
});

describe("LocalRepository assets", () => {
  it("stores blobs with metadata and finds them case-insensitively", async () => {
    const repo = freshRepository();
    await repo.putAsset({
      id: ASSET_A.toUpperCase(),
      blob: blob(["abc"], "image/png"),
      name: "a.png",
      width: 10,
      height: 20,
    });
    const asset = await repo.getAsset(ASSET_A);
    expect(asset).toMatchObject({
      id: ASSET_A,
      name: "a.png",
      mime: "image/png",
      width: 10,
      height: 20,
    });
    expect(asset?.blob.size).toBe(3);
    expect(await repo.listAssets()).toHaveLength(1);
  });

  it("caches object URLs, revokes them on delete and on pagehide", async () => {
    const repo = freshRepository();
    const create = vi.fn(() => "blob:one");
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }),
    );
    try {
      await repo.putAsset({
        id: ASSET_A,
        blob: blob(["x"], "image/png"),
        name: "a",
        width: 1,
        height: 1,
      });
      const first = await repo.getAssetObjectUrl(ASSET_A);
      const second = await repo.getAssetObjectUrl(ASSET_A);
      expect(first).toBe("blob:one");
      expect(second).toBe(first);
      expect(create).toHaveBeenCalledTimes(1);
      await repo.deleteAsset(ASSET_A);
      expect(revoke).toHaveBeenCalledWith("blob:one");
      expect(await repo.getAssetObjectUrl(ASSET_A)).toBeNull();

      await repo.putAsset({
        id: ASSET_B,
        blob: blob(["y"]),
        name: "b",
        width: 1,
        height: 1,
      });
      await repo.getAssetObjectUrl(ASSET_B);
      window.dispatchEvent(new Event("pagehide"));
      expect(revoke).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deleting a design removes assets only it used, keeping shared ones", async () => {
    const repo = freshRepository();
    for (const id of [ASSET_A, ASSET_B])
      await repo.putAsset({
        id,
        blob: blob([id]),
        name: id,
        width: 1,
        height: 1,
      });
    await repo.saveDesign({
      id: "d1",
      title: "one",
      document: docWithImages(ASSET_A, ASSET_B),
    });
    await repo.saveDesign({
      id: "d2",
      title: "two",
      document: docWithImages(ASSET_B),
    });
    await repo.deleteDesign("d1");
    expect(await repo.getAsset(ASSET_A)).toBeNull();
    expect(await repo.getAsset(ASSET_B)).not.toBeNull();
    await repo.deleteDesign("d2");
    expect(await repo.getAsset(ASSET_B)).toBeNull();
  });
});

describe("LocalRepository resilience", () => {
  it("allows a retry after the backing store fails to open", async () => {
    const store = createMemoryStore();
    let attempts = 0;
    const repo = new LocalRepository(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("database temporarily blocked");
      return { store, mode: "indexeddb" };
    });

    await expect(repo.getDesign("d1")).rejects.toThrow(
      "database temporarily blocked",
    );
    await expect(repo.getDesign("d1")).resolves.toBeNull();
    expect(attempts).toBe(2);
  });

  it("reopens after an already-open backing store fails an operation", async () => {
    const memory = createMemoryStore();
    let opens = 0;
    let fail = true;
    const failing: LocalStore = {
      ...memory,
      getDesign: async (id) => {
        if (fail) {
          fail = false;
          throw new Error("database connection closed");
        }
        return memory.getDesign(id);
      },
    };
    const repo = new LocalRepository(async () => {
      opens += 1;
      return { store: failing, mode: "indexeddb" };
    });

    await expect(repo.getDesign("d1")).rejects.toThrow(
      "database connection closed",
    );
    await expect(repo.getDesign("d1")).resolves.toBeNull();
    expect(opens).toBe(2);
  });

  it("does not hide an IndexedDB opener failure behind an empty memory store", async () => {
    const original = globalThis.indexedDB;
    const failure = new Error("database temporarily blocked");
    // @ts-expect-error simulate an IndexedDB opener failure
    globalThis.indexedDB = {
      open: () => {
        throw failure;
      },
    };
    try {
      await expect(openBrowserStore()).rejects.toThrow(
        "database temporarily blocked",
      );
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("maps QuotaExceededError to LocalStorageFullError", async () => {
    const memory = createMemoryStore();
    const failing: LocalStore = {
      ...memory,
      putDesign: async () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    const repo = new LocalRepository(async () => ({
      store: failing,
      mode: "indexeddb",
    }));
    await expect(
      repo.saveDesign({
        id: "d",
        title: "t",
        document: createBlankDocument(1, 1),
      }),
    ).rejects.toBeInstanceOf(LocalStorageFullError);
  });

  it("wraps unknown storage failures in LocalStorageError", async () => {
    const memory = createMemoryStore();
    const failing: LocalStore = {
      ...memory,
      putAsset: async () => {
        throw new Error("boom");
      },
    };
    const repo = new LocalRepository(async () => ({
      store: failing,
      mode: "indexeddb",
    }));
    await expect(
      repo.putAsset({ blob: blob(["x"]), name: "x", width: 1, height: 1 }),
    ).rejects.toBeInstanceOf(LocalStorageError);
  });

  it("falls back to an in-memory store and notifies subscribers when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate a browser without IndexedDB (private mode)
    globalThis.indexedDB = undefined;
    try {
      const repo = new LocalRepository();
      const listener = vi.fn();
      repo.subscribe(listener);
      expect(repo.getStorageMode()).toBe("indexeddb");
      await repo.createDesign({
        title: "Temp",
        document: createBlankDocument(10, 10),
      });
      expect(repo.getStorageMode()).toBe("memory");
      expect(listener).toHaveBeenCalled();
      expect(await repo.listDesigns()).toHaveLength(1);
      expect(await repo.requestPersistence()).toBe(false);
      const opened = await openBrowserStore();
      expect(opened.mode).toBe("memory");
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("asks the browser for persistent storage only once", async () => {
    const repo = freshRepository();
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", {
      ...navigator,
      storage: { persist, estimate: async () => ({ usage: 100, quota: 1000 }) },
    });
    window.localStorage.removeItem("doory-storage-persist-requested");
    try {
      await repo.ready();
      await repo.requestPersistence();
      await repo.requestPersistence();
      expect(persist).toHaveBeenCalledTimes(1);
      await repo.putAsset({
        blob: blob(["12345"]),
        name: "n",
        width: 1,
        height: 1,
      });
      expect(await repo.estimateUsage()).toEqual({
        usage: 100,
        quota: 1000,
        assetBytes: 5,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears everything", async () => {
    const repo = freshRepository();
    await repo.createDesign({
      title: "x",
      document: createBlankDocument(1, 1),
    });
    await repo.putAsset({ blob: blob(["1"]), name: "n", width: 1, height: 1 });
    await repo.clear();
    expect(await repo.listDesigns()).toEqual([]);
    expect(await repo.listAssets()).toEqual([]);
  });
});
