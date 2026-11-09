const COLLABORATOR_COLORS = [
  "#c2410c",
  "#6d28d9",
  "#0f766e",
  "#15803d",
  "#be185d",
  "#b45309",
  "#1d4ed8",
  "#4d7c0f",
] as const;

const GOLDEN_ANGLE = 137.508;

function nextColor(used: ReadonlySet<string>, seed: number): string {
  const paletteColor = COLLABORATOR_COLORS.find((color) => !used.has(color));
  if (paletteColor) return paletteColor;

  let index = seed;
  while (true) {
    const color = `hsl(${Math.round((index * GOLDEN_ANGLE) % 360)} 68% 38%)`;
    if (!used.has(color)) return color;
    index += 1;
  }
}

/** Keeps peer colours stable while guaranteeing that active peers do not share one. */
export function colorCollaborators(
  ids: readonly string[],
  remembered: Map<string, string>,
): Map<string, string> {
  const used = new Set<string>();
  const colors = new Map<string, string>();

  for (const id of ids) {
    const previous = remembered.get(id);
    const color =
      previous && !used.has(previous)
        ? previous
        : nextColor(used, remembered.size);
    remembered.set(id, color);
    colors.set(id, color);
    used.add(color);
  }

  return colors;
}
