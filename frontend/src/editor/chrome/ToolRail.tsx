import { type KeyboardEvent, useCallback } from "react";
import { useEditorState } from "../context";
import { type PanelDefinition } from "../panels/registry";
import { useVisiblePanels } from "../panels/useVisiblePanels";
import { t } from "../strings";
import { useChrome, useOpenTool } from "./ChromeContext";
import styles from "./ToolRail.module.css";

function RailEntry({
  panel,
  open,
  onToggle,
  onKeyDown,
}: {
  panel: PanelDefinition;
  open: boolean;
  onToggle: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const chrome = useChrome();
  const ref = useCallback(
    (el: HTMLButtonElement | null) => chrome.setAnchor(panel.id, el),
    [chrome, panel.id],
  );
  return (
    <button
      ref={ref}
      type="button"
      className={styles.entry}
      aria-pressed={open}
      title={
        panel.shortcut ? `${panel.label} (${panel.shortcut})` : panel.label
      }
      data-testid={`ed-add-entry-${panel.id}`}
      data-tool={panel.id}
      onPointerEnter={panel.preload}
      onFocus={panel.preload}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        chrome.setKeyboardOpen(e.detail === 0);
        onToggle();
      }}
    >
      <span className={styles.icon}>{panel.icon}</span>
      <span className={styles.label}>{panel.label}</span>
    </button>
  );
}

/**
 * The tools that add to the design: a rail down the left edge on wide screens, a scrolling bar along the bottom
 * below the desktop breakpoint. A tool's panel stays open beside the rail until its entry is pressed again or the
 * panel is closed, so several things can be added in a row.
 */
export function ToolRail({ edge }: { edge: "side" | "bottom" }) {
  const readOnly = useEditorState((s) => s.readOnly);
  const compact = useEditorState((s) => s.ui.compact);
  const visible = useVisiblePanels();
  const { openId, toggle } = useOpenTool();
  const tools = visible.filter(
    (p) => p.slot !== "end" && (!readOnly || p.readOnly),
  );
  if (tools.length === 0 || compact !== (edge === "bottom")) return null;
  return (
    <nav
      className={styles.rail}
      data-orientation={edge === "bottom" ? "horizontal" : "vertical"}
      aria-label={t.chrome.tools}
      data-testid="ed-tool-rail"
    >
      {tools.map((p, index) => (
        <RailEntry
          key={p.id}
          panel={p}
          open={openId === p.id}
          onToggle={() => toggle(p.id)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0;
            if (next === 0) return;
            event.preventDefault();
            const entries = event.currentTarget
              .closest<HTMLElement>('[data-testid="ed-tool-rail"]')
              ?.querySelectorAll<HTMLButtonElement>("button");
            entries?.[(index + next + tools.length) % tools.length]?.focus();
          }}
        />
      ))}
    </nav>
  );
}
