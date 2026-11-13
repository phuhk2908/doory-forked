/**
 * The compare preview's geometry. In Detail the picture is drawn at DETAIL_ZOOM times the frame and moved inside it; the
 * pan is its offset in percent of the frame: 0 shows its left (top) edge, -(zoom - 1) × 100 its right (bottom) edge.
 */
export const DETAIL_ZOOM = 3;

export interface Pan {
  x: number;
  y: number;
}

/** How far a key press moves the picture, in percent of the frame. */
export const KEY_STEP = 10;

const lowest = (zoom: number): number => -(zoom - 1) * 100;

export function centerPan(zoom = DETAIL_ZOOM): Pan {
  return { x: lowest(zoom) / 2, y: lowest(zoom) / 2 };
}

/** Keeps the picture covering the frame. */
export function clampPan(pan: Pan, zoom = DETAIL_ZOOM): Pan {
  const min = lowest(zoom);
  return {
    x: Math.min(0, Math.max(min, pan.x)),
    y: Math.min(0, Math.max(min, pan.y)),
  };
}

/** A drag of `dx`, `dy` px moves the picture with the pointer. */
export function dragPan(
  start: Pan,
  dx: number,
  dy: number,
  frame: { width: number; height: number },
  zoom = DETAIL_ZOOM,
): Pan {
  if (frame.width <= 0 || frame.height <= 0) return start;
  return clampPan(
    {
      x: start.x + (dx / frame.width) * 100,
      y: start.y + (dy / frame.height) * 100,
    },
    zoom,
  );
}

/** The wheel moves the view (the picture the other way); Shift turns a vertical wheel sideways. */
export function wheelPan(
  pan: Pan,
  wheel: { deltaX: number; deltaY: number; shiftKey: boolean },
  frame: { width: number; height: number },
  zoom = DETAIL_ZOOM,
): Pan {
  let { deltaX: dx, deltaY: dy } = wheel;
  if (wheel.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  return dragPan(pan, -dx, -dy, frame, zoom);
}

const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [KEY_STEP, 0],
  ArrowRight: [-KEY_STEP, 0],
  ArrowUp: [0, KEY_STEP],
  ArrowDown: [0, -KEY_STEP],
};

/** An arrow key looks that way (the picture moves the other); null for other keys. */
export function keyPan(pan: Pan, key: string, zoom = DETAIL_ZOOM): Pan | null {
  const step = KEYS[key];
  return step
    ? clampPan({ x: pan.x + step[0], y: pan.y + step[1] }, zoom)
    : null;
}

/** The compare line at a pointer's x, in percent of the frame. */
export function splitAt(
  clientX: number,
  frame: { left: number; width: number },
): number {
  if (frame.width <= 0) return 50;
  return Math.min(
    100,
    Math.max(0, ((clientX - frame.left) / frame.width) * 100),
  );
}

/** A pointer this close to the compare line (px) moves the line, not the picture. */
export const LINE_GRAB = 22;
