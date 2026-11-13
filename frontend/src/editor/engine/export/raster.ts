/**
 * The picture formats of an export (PNG, JPG, WebP, AVIF): what the browser makes itself and what takes the server. The
 * encoding itself is in `encode.ts`, loaded when a file is made.
 */
import type { EditorAdapter, OptimizeFormat } from "@/types/adapter";
import type { ExportOptions } from "./registry";

export type RasterFormat = OptimizeFormat;

export const RASTER_MIME: Record<RasterFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export const isLossy = (format: RasterFormat): boolean => format !== "png";

/** Whether a format keeps transparency (JPG is flattened on white). */
export const hasAlpha = (format: RasterFormat): boolean => format !== "jpg";

let webpInBrowser: boolean | null = null;

/** Whether this browser makes the format from a canvas itself. Checked once: Safari draws WebP as PNG. */
export function browserEncodes(format: RasterFormat): boolean {
  if (format === "png" || format === "jpg") return true;
  if (format === "avif") return false;
  if (webpInBrowser === null) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      webpInBrowser = canvas
        .toDataURL("image/webp")
        .startsWith("data:image/webp");
    } catch {
      webpInBrowser = false;
    }
  }
  return webpInBrowser;
}

/** Tests: forget what was learned about the browser (or pretend). */
export function setBrowserWebpForTests(value: boolean | null): void {
  webpInBrowser = value;
}

export type OptimizeAdapter = Pick<EditorAdapter, "image">;

/** Whether the server can make `format` from a PNG for this editor. */
export function serverConverts(
  adapter: OptimizeAdapter,
  format: RasterFormat,
): boolean {
  return adapter.image?.info.formats.includes(format) === true;
}

/** The encoding options of an export that matter for one picture. */
export type RasterOptions = Pick<
  ExportOptions,
  | "quality"
  | "maxBytes"
  | "pngColors"
  | "transparent"
  | "optimize"
  | "optimizer"
  | "stripMetadata"
  | "progressive"
>;

/** Whether making `format` with `options` takes the server (when it is there): browsers make neither palette PNGs nor progressive JPGs. */
export function wantsServer(
  format: RasterFormat,
  options: RasterOptions,
): boolean {
  return (
    options.optimize === true ||
    !browserEncodes(format) ||
    (format === "png" && options.pngColors === 256) ||
    (format === "jpg" && options.progressive === true)
  );
}
