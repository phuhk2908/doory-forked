import type { SizePreset } from "@/lib/sizePresets";
import type { EditorEngine } from "../../engine/editor";
import {
  formatAvailable,
  optimizesByDefault,
  suggestionFor,
} from "../../engine/export/choices";
import {
  DEFAULT_EXPORT_OPTIONS,
  type ExportOptions,
  QUALITY_PRESETS,
  exportFormats,
} from "../../engine/export/registry";
import { t } from "../../strings";
import type { PrintPresetId } from "../print/printOptions";

export type PurposeIcon =
  "preset" | "web" | "graphic" | "print" | "document" | "video";

/** One "What is it for?" card: a format and the options that suit it. */
export interface Purpose {
  id: string;
  icon: PurposeIcon;
  label: string;
  hint: string;
  /** The design's own size preset (marked "Your size"). */
  own?: boolean;
  formatId: string;
  options: ExportOptions;
  /** The print setup the card picks (PDF). */
  print?: PrintPresetId;
  /** The size preset behind the card, for its icon. */
  preset?: SizePreset;
}

const balanced = {
  quality: QUALITY_PRESETS.balanced / 100,
  qualityPreset: "balanced" as const,
};

/**
 * The cards for this editor: the design's own preset first (while the page still has its size), then the common uses.
 * A card whose format this editor can't make is left out.
 */
export function purposesFor(
  engine: EditorEngine,
  preset: SizePreset | null,
): Purpose[] {
  const p = t.dialog.downloadPurposes;
  const out: Purpose[] = [];
  if (preset && preset.unit === "px") {
    const choice = suggestionFor(engine, preset);
    const label = exportFormats.get(choice.formatId)?.label ?? choice.formatId;
    out.push({
      id: "preset",
      icon: "preset",
      label: preset.label,
      hint: t.dialog.downloadPresetHint(label, preset.width, preset.height),
      own: true,
      preset,
      ...choice,
    });
  }
  const web = formatAvailable(engine, "webp") ? "webp" : "jpg";
  out.push({
    id: "web",
    icon: "web",
    label: p.web,
    hint: p.webHint(exportFormats.get(web)?.label ?? web),
    formatId: web,
    options: {
      ...DEFAULT_EXPORT_OPTIONS,
      ...balanced,
      size: "2x",
      optimize: optimizesByDefault(engine, web),
    },
  });
  out.push({
    id: "graphic",
    icon: "graphic",
    label: p.graphic,
    hint: p.graphicHint,
    formatId: "png",
    options: {
      ...DEFAULT_EXPORT_OPTIONS,
      size: "2x",
      transparent: true,
      optimize: optimizesByDefault(engine, "png"),
    },
  });
  const printFormat = formatAvailable(engine, "pdf-server")
    ? "pdf-server"
    : "pdf";
  out.push({
    id: "print",
    icon: "print",
    label: p.print,
    hint: p.printHint,
    own: !!preset && preset.unit !== "px",
    formatId: printFormat,
    options: DEFAULT_EXPORT_OPTIONS,
    print: "standard",
  });
  out.push({
    id: "document",
    icon: "document",
    label: p.document,
    hint: p.documentHint,
    formatId: "pdf",
    options: DEFAULT_EXPORT_OPTIONS,
    print: "screen",
  });
  if (formatAvailable(engine, "mp4"))
    out.push({
      id: "video",
      icon: "video",
      label: p.video,
      hint: p.videoHint,
      formatId: "mp4",
      options: DEFAULT_EXPORT_OPTIONS,
    });
  return out.filter((purpose) => formatAvailable(engine, purpose.formatId));
}
