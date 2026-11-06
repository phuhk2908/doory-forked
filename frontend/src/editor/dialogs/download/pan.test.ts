import { describe, expect, it } from "vitest";
import {
  DETAIL_ZOOM,
  centerPan,
  clampPan,
  dragPan,
  keyPan,
  splitAt,
  wheelPan,
} from "./pan";

const frame = { width: 400, height: 500 };

describe("compare preview panning", () => {
  it("starts in the middle of the 3× picture", () => {
    expect(DETAIL_ZOOM).toBe(3);
    expect(centerPan()).toEqual({ x: -100, y: -100 });
  });

  it("keeps the picture over the whole frame", () => {
    expect(clampPan({ x: 20, y: -250 })).toEqual({ x: 0, y: -200 });
    expect(clampPan({ x: -50, y: -60 }, 2)).toEqual({ x: -50, y: -60 });
    expect(clampPan({ x: -150, y: 0 }, 2)).toEqual({ x: -100, y: 0 });
  });

  it("a drag moves the picture with the pointer, in percent of the frame", () => {
    expect(dragPan({ x: -100, y: -100 }, 40, -50, frame)).toEqual({
      x: -90,
      y: -110,
    });
    expect(dragPan({ x: -100, y: -100 }, 4000, 0, frame)).toEqual({
      x: 0,
      y: -100,
    });
    expect(
      dragPan({ x: -100, y: -100 }, 10, 10, { width: 0, height: 0 }),
    ).toEqual({ x: -100, y: -100 });
  });

  it("the wheel scrolls the view; Shift + wheel goes sideways", () => {
    expect(
      wheelPan(
        { x: -100, y: -100 },
        { deltaX: 0, deltaY: 50, shiftKey: false },
        frame,
      ),
    ).toEqual({ x: -100, y: -110 });
    expect(
      wheelPan(
        { x: -100, y: -100 },
        { deltaX: 0, deltaY: 40, shiftKey: true },
        frame,
      ),
    ).toEqual({ x: -110, y: -100 });
    // A trackpad that already scrolls sideways keeps both directions.
    expect(
      wheelPan(
        { x: -100, y: -100 },
        { deltaX: -40, deltaY: 50, shiftKey: true },
        frame,
      ),
    ).toEqual({ x: -90, y: -110 });
  });

  it("arrow keys look around in steps, within the picture", () => {
    expect(keyPan({ x: -100, y: -100 }, "ArrowRight")).toEqual({
      x: -110,
      y: -100,
    });
    expect(keyPan({ x: -100, y: -100 }, "ArrowUp")).toEqual({
      x: -100,
      y: -90,
    });
    expect(keyPan({ x: 0, y: -100 }, "ArrowLeft")).toEqual({ x: 0, y: -100 });
    expect(keyPan({ x: -100, y: -100 }, "Enter")).toBeNull();
  });

  it("places the compare line where the pointer is", () => {
    expect(splitAt(300, { left: 100, width: 400 })).toBe(50);
    expect(splitAt(0, { left: 100, width: 400 })).toBe(0);
    expect(splitAt(900, { left: 100, width: 400 })).toBe(100);
  });
});
