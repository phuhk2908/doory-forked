/**
 * Makes an MP4, a WebM or an animated GIF of a saved design for the server's export, with the editor's own video
 * pipeline (`engine/export/video`): the same timeline, frames, encoders and muxers as the Download dialog's video.
 *
 * The server's browser never records in real time (`serverCodecs`) and writes GIFs on the page's thread, so the page
 * needs no worker script. The pipeline loads with `import()` when a video is asked for, as in the editor. The file stays in the page after `renderDesignVideo`, and the server reads it in slices
 * (`videoSlice`): a large video never travels as one string.
 */
import type { FontFamily } from "@/types/api";
import { AudioLoadError, SourceStore } from "../audio/sources";
import { fontsInObjects } from "../engine/docOps";
import { type CodecApi, browserCodecs } from "../engine/export/video/codecs";
import { VideoExportError } from "../engine/export/video/errors";
import {
  type FitMode,
  type Resolution,
  VIDEO_FORMATS,
  type VideoFormat,
  type VideoOptions,
  type VideoQuality,
  defaultVideoOptions,
  isValidVideoOptions,
} from "../engine/export/video/options";
import type { Deps, VideoWarning } from "../engine/export/video/types";
import { renderableObjects } from "../engine/render";
import { RenderError, base64, open, pickPage } from "./render";

export interface VideoInput {
  /** The design's document JSON, as stored. */
  document: unknown;
  /** Page indexes (0-based) or ids, in the order they play. Default: the first page. */
  pages?: (number | string)[];
  format: VideoFormat;
  /** The options of the Download dialog's video section; each defaults as there. */
  resolution?: Resolution;
  fps?: number;
  quality?: VideoQuality;
  fit?: FitMode;
  /** MP4 and WebM: put the design's sound in the file. */
  sound?: boolean;
  /** GIF: how often it plays, 0 = forever. */
  loops?: number;
  dither?: boolean;
  /** Seconds every page is held; absent or `null` = each page's own time. */
  pageSeconds?: number | null;
  /** The longest video the server makes, ms. */
  maxMs?: number;
  /** The largest file the server keeps, bytes. */
  maxBytes?: number;
  fonts?: FontFamily[];
}

export interface RenderedVideo {
  mime: string;
  /** Size of the file, which `videoSlice` reads. */
  bytes: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationMs: number;
  /** What the picture and the sound were made with: `H.264`, `VP9`, `GIF`; `Opus`, `AAC` or `null`. */
  video: string;
  audio: string | null;
  warnings: VideoWarning[];
  pageIds: string[];
  pageIndexes: number[];
  placeholders: number;
  missingFonts: string[];
}

/** The browser's encoders without real-time recording: a server makes a file with WebCodecs or not at all. */
export const serverCodecs: CodecApi = {
  ...browserCodecs,
  hasRecorder: () => false,
};

/** The last file made, until the next export. */
let made: Blob | null = null;

const isFormat = (value: unknown): value is VideoFormat =>
  (VIDEO_FORMATS as readonly unknown[]).includes(value);

/** The options of `input`: those it gives over the format's defaults. */
function optionsOf(input: VideoInput): VideoOptions {
  const given: Partial<VideoOptions> = {
    resolution: input.resolution,
    fps: input.fps,
    quality: input.quality,
    fit: input.fit,
    audio: input.sound,
    loops: input.loops,
    dither: input.dither,
    pageSeconds: input.pageSeconds,
  };
  const options: VideoOptions = { ...defaultVideoOptions(input.format) };
  for (const [key, value] of Object.entries(given))
    if (value !== undefined) Object.assign(options, { [key]: value });
  return options;
}

/** The pipeline's failures as the codes the server knows; anything else stays as it is (`render_failed`). */
function translated(error: unknown): unknown {
  if (!(error instanceof VideoExportError)) return error;
  if (error.cause instanceof AudioLoadError)
    return new RenderError("sound_unavailable", error.cause.message);
  if (error.code === "invalid-options" || error.code === "no-pages")
    return new RenderError("invalid_options", error.message);
  if (error.code === "too-long")
    return new RenderError("too_long", error.message);
  if (error.code === "gif-too-large")
    return new RenderError("too_large", error.message);
  if (error.code === "unsupported")
    return new RenderError("video_unsupported", error.message);
  return new Error(
    error.detail ? `${error.message} (${error.detail})` : error.message,
  );
}

export async function renderDesignVideo(
  input: VideoInput,
  deps: Partial<Deps> = {},
): Promise<RenderedVideo> {
  made = null;
  if (!isFormat(input.format))
    throw new RenderError(
      "invalid_options",
      "The format must be mp4, webm or gif.",
    );
  const options = optionsOf(input);
  if (!isValidVideoOptions(options))
    throw new RenderError(
      "invalid_options",
      `These settings are not offered for ${input.format}.`,
    );
  const session = open(input.document, input.fonts);
  const chosen = (input.pages ?? [undefined]).map((ref) =>
    pickPage(session.doc, ref),
  );
  const pages = chosen.map(([page, index]) => ({ page, index }));
  const { prepare, runVideoExport } =
    await import("../engine/export/video/pipeline");
  try {
    const { timeline } = prepare(session.doc, pages, options);
    if (input.maxMs !== undefined && timeline.totalMs > input.maxMs) {
      throw new RenderError(
        "too_long",
        `The video would last ${Math.ceil(timeline.totalMs / 1000)} s; this server makes at most ${Math.floor(input.maxMs / 1000)} s.`,
      );
    }
    const sounds = new SourceStore();
    const result = await runVideoExport({
      host: { loadContext: session.ctx, loadSound: sounds.load },
      document: session.doc,
      pages,
      options,
      title: "design",
      signal: new AbortController().signal,
      deps: { codecs: serverCodecs, gifWorker: null, ...deps },
    });
    if (input.maxBytes !== undefined && result.blob.size > input.maxBytes) {
      throw new RenderError(
        "too_large",
        `The file would be ${Math.ceil(result.blob.size / 1048576)} MB; this server keeps at most ${Math.floor(input.maxBytes / 1048576)} MB.`,
      );
    }
    made = result.blob;
    const missingFonts = await session.fonts.unavailable(
      fontsInObjects(
        chosen.flatMap(([page]) => renderableObjects(page.objects)),
      ),
    );
    return {
      mime: result.mime,
      bytes: result.blob.size,
      width: result.width,
      height: result.height,
      fps: result.fps,
      frames: result.frames,
      durationMs: result.durationMs,
      video: result.video,
      audio: result.audio,
      warnings: result.warnings,
      pageIds: chosen.map(([page]) => page.id),
      pageIndexes: chosen.map(([, index]) => index),
      placeholders: session.placeholders(),
      missingFonts,
    };
  } catch (error) {
    throw translated(error);
  }
}

/** `length` bytes of the last file from `offset`, in base64; empty past its end. */
export function videoSlice(offset: number, length: number): Promise<string> {
  if (!made)
    return Promise.reject(
      new RenderError(
        "invalid_options",
        "No video has been made on this page.",
      ),
    );
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length <= 0
  )
    return Promise.reject(
      new RenderError("invalid_options", "Give a whole offset and length."),
    );
  return base64(made.slice(offset, offset + length));
}
