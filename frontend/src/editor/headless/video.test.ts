import { describe, expect, it } from "vitest";
import type { DoryDocument } from "@/types/document";
import { AudioLoadError } from "../audio/sources";
import type { CodecApi } from "../engine/export/video/codecs";
import { inspectGif } from "../engine/export/video/inspect";
import { doc, page, rect } from "../engine/export/video/testing";
import type { Deps } from "../engine/export/video/types";
import { RenderError } from "./render";
import {
  type VideoInput,
  renderDesignVideo,
  serverCodecs,
  videoSlice,
} from "./video";

const design = (): DoryDocument =>
  doc(
    [
      page("a", { durationSec: 1, objects: [rect("r")] }),
      page("b", { durationSec: 2 }),
    ],
    200,
    100,
  );
const gif: VideoInput = {
  document: design(),
  format: "gif",
  resolution: 240,
  fps: 5,
  dither: false,
};

const withTrack = (): DoryDocument =>
  ({
    ...design(),
    audioTracks: [
      {
        id: "t",
        kind: "music",
        name: "m",
        src: "/media/x.ogg",
        scope: { type: "design" },
        startMs: 0,
        trimStartMs: 0,
        trimEndMs: 5000,
        volume: 1,
        fadeInMs: 0,
        fadeOutMs: 0,
        loop: true,
        muted: false,
      },
    ],
  }) as DoryDocument;

/** A browser that encodes everything: the pipeline gets past the plan and starts on the sound. */
const encoders = (over: Partial<CodecApi> = {}): CodecApi => ({
  hasVideoEncoder: () => true,
  videoSupported: async () => true,
  audioCodec: async () => true,
  recorderType: () => true,
  hasRecorder: () => false,
  ...over,
});

async function renderError(promise: Promise<unknown>): Promise<RenderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RenderError) return error;
    throw error;
  }
  throw new Error("expected a RenderError");
}

const decoded = (data: string): Uint8Array =>
  Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

describe("renderDesignVideo", () => {
  it("makes a GIF of the chosen pages and keeps it for the server to read in slices", async () => {
    const out = await renderDesignVideo({ ...gif, pages: [1, "a"] });
    expect(out).toMatchObject({
      mime: "image/gif",
      video: "GIF",
      audio: null,
      fps: 5,
      durationMs: 3000,
      pageIds: ["b", "a"],
      pageIndexes: [1, 0],
      placeholders: 0,
      missingFonts: [],
    });
    expect([out.width, out.height]).toEqual([480, 240]);
    const head = decoded(await videoSlice(0, 1000));
    const rest = decoded(await videoSlice(1000, out.bytes));
    expect(head.length + rest.length).toBe(out.bytes);
    const file = new Uint8Array(out.bytes);
    file.set(head);
    file.set(rest, head.length);
    expect(inspectGif(file)).toMatchObject({
      width: 480,
      height: 240,
      loop: 0,
      trailer: true,
      totalCs: 300,
    });
    expect(await videoSlice(out.bytes, 10)).toBe("");
  });

  it("takes the first page and the format defaults when nothing else is given", async () => {
    const out = await renderDesignVideo({ document: design(), format: "gif" });
    expect(out).toMatchObject({ fps: 15, durationMs: 1000, pageIds: ["a"] });
    expect(out.height).toBe(480);
  });

  it("refuses a format, settings and pages the editor does not offer, with a code", async () => {
    expect(
      (await renderError(renderDesignVideo({ ...gif, format: "mov" as never })))
        .code,
    ).toBe("invalid_options");
    expect(
      (await renderError(renderDesignVideo({ ...gif, fps: 60 }))).code,
    ).toBe("invalid_options");
    expect(
      (await renderError(renderDesignVideo({ ...gif, resolution: 1080 }))).code,
    ).toBe("invalid_options");
    expect(
      (await renderError(renderDesignVideo({ ...gif, pages: [2] }))).code,
    ).toBe("page_not_found");
    expect(
      (
        await renderError(
          renderDesignVideo({ ...gif, document: "not a design" }),
        )
      ).code,
    ).toBe("invalid_document");
  });

  it("refuses a video longer than the server allows before drawing a frame", async () => {
    const error = await renderError(
      renderDesignVideo({ ...gif, pages: [0, 1], maxMs: 2000 }),
    );
    expect(error.code).toBe("too_long");
    expect(error.message).toContain("3 s");
    expect(
      (await renderError(renderDesignVideo({ ...gif, pageSeconds: 600 }))).code,
    ).toBe("too_long");
  });

  it("refuses a file larger than the server keeps, and then has nothing to read", async () => {
    await renderDesignVideo(gif);
    expect(
      (await renderError(renderDesignVideo({ ...gif, maxBytes: 10 }))).code,
    ).toBe("too_large");
    expect((await renderError(videoSlice(0, 10))).code).toBe("invalid_options");
  });

  it("never records in real time: a browser without a video encoder cannot make a video", async () => {
    expect(serverCodecs.hasRecorder()).toBe(false);
    const deps: Partial<Deps> = {
      codecs: encoders({ hasVideoEncoder: () => false }),
    };
    expect(
      (
        await renderError(
          renderDesignVideo({ document: design(), format: "webm" }, deps),
        )
      ).code,
    ).toBe("video_unsupported");
  });

  it("names a sound file that could not be loaded", async () => {
    const deps: Partial<Deps> = {
      codecs: encoders(),
      mix: async () => {
        throw new AudioLoadError("missing", "“m” is missing from the server.");
      },
    };
    const error = await renderError(
      renderDesignVideo({ document: withTrack(), format: "mp4" }, deps),
    );
    expect(error).toMatchObject({
      code: "sound_unavailable",
      message: "“m” is missing from the server.",
    });
  });
});
