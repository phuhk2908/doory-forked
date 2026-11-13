import { readImageInfo } from "@/features/editor/adapters/images";
import { assetsApi } from "@/lib/api";
import {
  localRepository,
  type LocalAsset,
  type LocalRepository,
} from "@/lib/local";
import type { Asset } from "@/types/api";
import { versionNonce, type DrawingDocument, type DrawingFile } from "./model";

const LOCAL_IMAGE_URL = /^idb:\/\/([0-9a-f-]{36})$/iu;

export function drawingFileFromAsset(
  asset: Pick<Asset, "id" | "mime" | "name" | "url" | "width" | "height">,
): DrawingFile {
  return {
    id: asset.id,
    mime: asset.mime,
    name: asset.name,
    url: asset.url,
    width: asset.width,
    height: asset.height,
  };
}

export async function uploadDrawingImage(file: File): Promise<DrawingFile> {
  return drawingFileFromAsset(
    await assetsApi.upload(file, { name: file.name }),
  );
}

export async function storeLocalDrawingImage(
  file: File,
  repository: LocalRepository = localRepository,
): Promise<DrawingFile> {
  const info = await readImageInfo(file);
  const asset = await repository.putAsset({
    blob: file,
    name: file.name || "Image",
    mime: info.mime,
    width: info.width,
    height: info.height,
  });
  return {
    id: asset.id,
    mime: asset.mime,
    name: asset.name,
    url: `idb://${asset.id}`,
    width: asset.width,
    height: asset.height,
  };
}

export async function resolveDrawingImage(
  file: DrawingFile,
  repository: LocalRepository = localRepository,
): Promise<string> {
  const match = LOCAL_IMAGE_URL.exec(file.url.trim());
  if (!match) return file.url;
  const url = await repository.getAssetObjectUrl(match[1]);
  if (!url) throw new Error("This image is no longer stored in this browser.");
  return url;
}

function localAssetId(file: DrawingFile): string | null {
  const match = LOCAL_IMAGE_URL.exec(file.url.trim());
  return match?.[1].toLowerCase() ?? null;
}

export function hasLocalDrawingImages(document: DrawingDocument): boolean {
  return localDrawingAssetIds(document).length > 0;
}

export function localDrawingAssetIds(document: DrawingDocument): string[] {
  const files = document.files ?? {};
  return [
    ...new Set(
      document.elements.flatMap((element) => {
        if (element.type !== "image" || element.isDeleted) return [];
        const file = files[element.fileId];
        const id = file ? localAssetId(file) : null;
        return id ? [id] : [];
      }),
    ),
  ];
}

function localAssetFile(asset: LocalAsset): File | Blob {
  if (typeof File === "undefined") return asset.blob;
  return new File([asset.blob], asset.name, { type: asset.mime });
}

/** Uploads any local image references and rewrites their element/file ids. */
export async function migrateLocalDrawingFiles(
  document: DrawingDocument,
  repository: LocalRepository = localRepository,
): Promise<DrawingDocument> {
  const files = document.files ?? {};
  const references = new Map<string, DrawingFile>();
  for (const element of document.elements) {
    if (element.type !== "image" || element.isDeleted) continue;
    const file = files[element.fileId];
    if (file) references.set(element.fileId, file);
  }
  const localReferences = [...references.entries()].filter(([, file]) =>
    Boolean(localAssetId(file)),
  );
  const nextFiles = { ...files };
  for (const [fileId, file] of Object.entries(files)) {
    if (localAssetId(file) && !references.has(fileId)) delete nextFiles[fileId];
  }
  if (localReferences.length === 0)
    return Object.keys(nextFiles).length === Object.keys(files).length
      ? document
      : {
          ...document,
          files: Object.keys(nextFiles).length > 0 ? nextFiles : undefined,
        };

  const replacements = new Map<string, DrawingFile>();
  const uploadedByLocalAsset = new Map<string, DrawingFile>();
  for (const [referenceId, file] of localReferences) {
    const id = localAssetId(file);
    if (!id) continue;
    const existing = uploadedByLocalAsset.get(id);
    if (existing) {
      replacements.set(referenceId, existing);
      continue;
    }
    const asset = await repository.getAsset(id);
    if (!asset)
      throw new Error(`The local image “${file.name}” is no longer available.`);
    const uploaded = await assetsApi.upload(localAssetFile(asset), {
      name: asset.name,
    });
    const metadata = drawingFileFromAsset(uploaded);
    uploadedByLocalAsset.set(id, metadata);
    replacements.set(referenceId, metadata);
  }

  for (const [referenceId, uploaded] of replacements) {
    delete nextFiles[referenceId];
    nextFiles[uploaded.id] = uploaded;
  }
  const elements = document.elements.map((element) => {
    const replacement =
      element.type === "image" ? replacements.get(element.fileId) : undefined;
    return replacement
      ? {
          ...element,
          fileId: replacement.id,
          version: element.version + 1,
          versionNonce: versionNonce(),
        }
      : element;
  });
  return {
    ...document,
    elements,
    files: Object.keys(nextFiles).length > 0 ? nextFiles : undefined,
  };
}
