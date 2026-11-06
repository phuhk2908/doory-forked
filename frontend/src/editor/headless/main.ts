/**
 * Entry point of `render.html`: a page with no UI that the server's headless browser opens to draw a design. The
 * server calls `window.__dooryRender(input)` (one page as a PNG), `window.__dooryRenderPages(input)` (pages for the
 * SVG and PDF exports) or `window.__dooryRenderVideo(input)` (an MP4, WebM or GIF, then read with
 * `window.__dooryVideoSlice(offset, length)`) once `window.__dooryRenderReady` is true. Design fonts come only from
 * `input.fonts` (the app's bundled UI fonts are other families, e.g. "Plus Jakarta Sans Variable").
 */
import { canvasToBlob } from "../engine/render";
import {
  type PagesInput,
  type RenderErrorCode,
  type RenderInput,
  type RenderedPages,
  RenderError,
  base64,
  renderDesignPage,
  renderDesignPages,
} from "./render";
import {
  type RenderedVideo,
  type VideoInput,
  renderDesignVideo,
  videoSlice,
} from "./video";

type Failure = {
  ok: false;
  error: { code: RenderErrorCode | "render_failed"; message: string };
};

export type RenderResponse =
  | {
      ok: true;
      png: string;
      width: number;
      height: number;
      pageId: string;
      pageIndex: number;
      placeholders: number;
      missingFonts: string[];
    }
  | Failure;

export type RenderPagesResponse = ({ ok: true } & RenderedPages) | Failure;

export type RenderVideoResponse = ({ ok: true } & RenderedVideo) | Failure;

export type VideoSliceResponse = { ok: true; data: string } | Failure;

declare global {
  interface Window {
    __dooryRender?: (input: RenderInput) => Promise<RenderResponse>;
    __dooryRenderPages?: (input: PagesInput) => Promise<RenderPagesResponse>;
    __dooryRenderVideo?: (input: VideoInput) => Promise<RenderVideoResponse>;
    __dooryVideoSlice?: (
      offset: number,
      length: number,
    ) => Promise<VideoSliceResponse>;
    __dooryRenderReady?: boolean;
  }
}

function failure(error: unknown): Failure {
  if (error instanceof RenderError)
    return { ok: false, error: { code: error.code, message: error.message } };
  return {
    ok: false,
    error: {
      code: "render_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

window.__dooryRender = async (input) => {
  try {
    const { canvas, ...page } = await renderDesignPage(input);
    const png = await base64(await canvasToBlob(canvas, "image/png"));
    return {
      ok: true,
      png,
      width: canvas.width,
      height: canvas.height,
      ...page,
    };
  } catch (error) {
    return failure(error);
  }
};
window.__dooryRenderPages = async (input) => {
  try {
    return { ok: true, ...(await renderDesignPages(input)) };
  } catch (error) {
    return failure(error);
  }
};
window.__dooryRenderVideo = async (input) => {
  try {
    return { ok: true, ...(await renderDesignVideo(input)) };
  } catch (error) {
    return failure(error);
  }
};
window.__dooryVideoSlice = async (offset, length) => {
  try {
    return { ok: true, data: await videoSlice(offset, length) };
  } catch (error) {
    return failure(error);
  }
};
window.__dooryRenderReady = true;
