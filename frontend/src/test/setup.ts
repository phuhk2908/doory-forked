import "@testing-library/jest-dom/vitest";
import { setSizeChoicesForTests } from "@/lib/sizePresets/choices";
import { setSizePresetsForTests } from "@/lib/sizePresets/store";

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    constructor(_callback: ResizeObserverCallback) {}

    disconnect() {}

    observe(_target: Element, _options?: ResizeObserverOptions) {}

    unobserve(_target: Element) {}
  };
}

if (typeof window.matchMedia === "undefined") {
  window.matchMedia = (media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}

// Components read the size preset catalogue and the person's sizes; tests get the built-in catalogue and no
// choices, without a request for either.
beforeEach(() => {
  setSizePresetsForTests();
  setSizeChoicesForTests();
});
