/** `@font-face` rules for the fonts an SVG uses, so the file shows them anywhere: the SVG download and the server's SVG export. */
import type { FontFamily } from "@/types/api";
import type { DocObject } from "@/types/document";
import { fontsInObjects } from "../docOps";
import { blobToDataUrl } from "./svgEmbed";

/** The catalogue entry of a family (`FontManager.lookup`). */
export type FontLookup = (family: string) => Promise<FontFamily | null>;

/** Adds `@font-face` rules with data-URI fonts for catalog fonts used on the page (best effort). */
export async function embedFontFaces(
  svg: string,
  objects: DocObject[],
  lookup: FontLookup,
): Promise<string> {
  const uses = fontsInObjects(objects);
  if (uses.length === 0) return svg;
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const use of uses) {
    const entry = await lookup(use.family);
    if (!entry) continue;
    for (const v of entry.variants) {
      const key = `${v.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const res = await fetch(v.url, { credentials: "same-origin" });
        if (!res.ok) continue;
        const data = await blobToDataUrl(await res.blob());
        rules.push(
          `@font-face{font-family:"${entry.family}";font-weight:${v.weight};font-style:${v.style};src:url(${data});}`,
        );
      } catch {
        /* an unreachable font file only costs fidelity, not the export */
      }
    }
  }
  if (rules.length === 0) return svg;
  const style = `<style type="text/css"><![CDATA[${rules.join("")}]]></style>`;
  return svg.includes("<defs>")
    ? svg.replace("<defs>", `<defs>${style}`)
    : svg.replace(/(<svg[^>]*>)/, `$1<defs>${style}</defs>`);
}
