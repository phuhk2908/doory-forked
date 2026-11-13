import { createMemoryStore, LocalRepository } from "@/lib/local";
import { assetsApi } from "@/lib/api";
import { readImageInfo } from "@/features/editor/adapters/images";
import {
  drawingFileFromAsset,
  localDrawingAssetIds,
  migrateLocalDrawingFiles,
  resolveDrawingImage,
  storeLocalDrawingImage,
} from "./imageAssets";
import { blankDrawing, createElement } from "./model";

vi.mock("@/features/editor/adapters/images", () => ({
  readImageInfo: vi.fn(),
}));

describe("drawing image assets", () => {
  function repository(): LocalRepository {
    return new LocalRepository(async () => ({
      store: createMemoryStore(),
      mode: "memory",
    }));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores local image bytes outside the drawing document", async () => {
    const repo = repository();
    vi.mocked(readImageInfo).mockResolvedValue({
      kind: "image",
      mime: "image/png",
      width: 640,
      height: 480,
    });
    const file = new File(["image bytes"], "photo.png", {
      type: "image/png",
    });

    const metadata = await storeLocalDrawingImage(file, repo);

    expect(metadata).toMatchObject({
      mime: "image/png",
      name: "photo.png",
      url: expect.stringMatching(/^idb:\/\//),
      width: 640,
      height: 480,
    });
    const stored = await repo.getAsset(metadata.id);
    expect(stored?.blob).toBe(file);
  });

  it("resolves local references and leaves remote URLs untouched", async () => {
    const repo = repository();
    const asset = await repo.putAsset({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      blob: new Blob(["image bytes"], { type: "image/png" }),
      name: "photo.png",
      mime: "image/png",
      width: 10,
      height: 10,
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo");

    await expect(
      resolveDrawingImage(
        drawingFileFromAsset({
          id: asset.id,
          mime: asset.mime,
          name: asset.name,
          url: `idb://${asset.id}`,
          width: asset.width,
          height: asset.height,
        }),
        repo,
      ),
    ).resolves.toBe("blob:photo");
    await expect(
      resolveDrawingImage(
        {
          id: "remote",
          mime: "image/png",
          name: "remote.png",
          url: "https://cdn.test/remote.png",
        },
        repo,
      ),
    ).resolves.toBe("https://cdn.test/remote.png");
  });

  it("migrates local image references without embedding bytes", async () => {
    const repo = repository();
    const localId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await repo.putAsset({
      id: localId,
      blob: new Blob(["image bytes"], { type: "image/png" }),
      name: "photo.png",
      mime: "image/png",
      width: 400,
      height: 200,
    });
    vi.spyOn(assetsApi, "upload").mockResolvedValue({
      id: "server-image",
      kind: "image",
      name: "photo.png",
      url: "https://cdn.test/photo.png",
      thumb_url: "https://cdn.test/photo-thumb.png",
      width: 400,
      height: 200,
      size: 11,
      mime: "image/png",
      tags: [],
      attribution: null,
      created_at: "",
    });
    const image = createElement("image", {
      id: "image",
      fileId: localId,
      width: 200,
      height: 100,
    });
    const originalVersion = image.version;
    const originalVersionNonce = image.versionNonce;

    const migrated = await migrateLocalDrawingFiles(
      {
        ...blankDrawing(),
        elements: [image],
        files: {
          [localId]: {
            id: localId,
            mime: "image/png",
            name: "photo.png",
            url: `idb://${localId}`,
          },
        },
      },
      repo,
    );

    expect(assetsApi.upload).toHaveBeenCalledTimes(1);
    expect(migrated.elements[0]).toMatchObject({
      type: "image",
      fileId: "server-image",
      version: originalVersion + 1,
    });
    expect(migrated.elements[0]?.versionNonce).not.toBe(originalVersionNonce);
    expect(migrated.files).toEqual({
      "server-image": {
        id: "server-image",
        mime: "image/png",
        name: "photo.png",
        url: "https://cdn.test/photo.png",
        width: 400,
        height: 200,
      },
    });
    expect(JSON.stringify(migrated)).not.toContain("idb://");
  });

  it("reports each active local image asset once", () => {
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const deletedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const first = createElement("image", { fileId: id });
    const second = createElement("image", { fileId: id });
    const deleted = createElement("image", {
      fileId: deletedId,
      isDeleted: true,
    });

    expect(
      localDrawingAssetIds({
        ...blankDrawing(),
        elements: [first, second, deleted],
        files: {
          [id]: {
            id,
            mime: "image/png",
            name: "photo.png",
            url: `idb://${id}`,
          },
          [deletedId]: {
            id: deletedId,
            mime: "image/png",
            name: "deleted.png",
            url: `idb://${deletedId}`,
          },
        },
      }),
    ).toEqual([id]);
  });

  it("drops stale local metadata that is no longer used by an image", async () => {
    const staleId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const migrated = await migrateLocalDrawingFiles({
      ...blankDrawing(),
      files: {
        [staleId]: {
          id: staleId,
          mime: "image/png",
          name: "stale.png",
          url: `idb://${staleId}`,
        },
      },
    });

    expect(migrated.files).toBeUndefined();
  });
});
