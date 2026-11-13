import { blankDrawing } from "./model";
import {
  DrawingLocalRepository,
  type DrawingStore,
  type LocalDrawing,
} from "./local";

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

describe("drawing local repository", () => {
  it("retries after the IndexedDB opener fails", async () => {
    let attempts = 0;
    const store = memoryStore();
    const repository = new DrawingLocalRepository(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("database temporarily blocked");
      return store;
    });

    await expect(repository.get("drawing-1")).rejects.toThrow(
      "database temporarily blocked",
    );
    await expect(repository.get("drawing-1")).resolves.toBeNull();
    expect(attempts).toBe(2);
  });

  it("keeps the memory fallback when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate a browser without IndexedDB
    globalThis.indexedDB = undefined;
    try {
      const repository = new DrawingLocalRepository();
      await repository.save({
        id: "drawing-1",
        title: "Temporary",
        document: blankDrawing(),
      });
      await expect(repository.get("drawing-1")).resolves.toMatchObject({
        title: "Temporary",
      });
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("reopens after an already-open store fails an operation", async () => {
    let opens = 0;
    let fail = true;
    const store = memoryStore();
    const failingStore: DrawingStore = {
      ...store,
      get: async (id) => {
        if (fail) {
          fail = false;
          throw new Error("database connection closed");
        }
        return store.get(id);
      },
    };
    const repository = new DrawingLocalRepository(async () => {
      opens += 1;
      return failingStore;
    });

    await expect(repository.get("drawing-1")).rejects.toThrow(
      "database connection closed",
    );
    await expect(repository.get("drawing-1")).resolves.toBeNull();
    expect(opens).toBe(2);
  });
});
