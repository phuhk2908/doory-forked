import { loadable } from "../ui/loadable";

/** The size controls are only needed after opening a size popover. */
const LazySizePanel = loadable(
  () => import("./SizePanel").then((m) => m.SizePanel),
  { fallback: null },
);

export { LazySizePanel };
