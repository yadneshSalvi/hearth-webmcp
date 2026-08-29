"use client";
/**
 * The Tools panel proves WebMCP without an agent in the room: the live list of what is registered
 * on `document.modelContext` right now, grouped exactly as TOOLS.md §2 gates them, each with its
 * JSON Schema.
 */
import { useMemo } from "react";
import { hearthStore, useHearthStore } from "../state/store";
import type { ToolGroup, ToolMirror } from "../state/types";
import { useCopyFlash } from "./clipboard";
import { IconClose, IconCopy } from "./icons";
import { EmptyState, IconButton } from "./primitives";

const GROUP_ORDER: readonly ToolGroup[] = ["core", "design", "shop", "present", "preview", "variants", "checkout", "build"];

const GROUP_LABELS: Record<ToolGroup, string> = {
  core: "Core",
  design: "Design",
  shop: "Shop",
  present: "Present",
  preview: "Preview",
  variants: "Variants",
  checkout: "Checkout",
  build: "Build",
};

const GROUP_GATES: Partial<Record<ToolGroup, string>> = {
  preview: "registered while a preview ghost exists",
  variants: "registered with two or more saved variants",
  checkout: "registered when the cart has a line",
  build: "registered in Build mode",
};

/** Chrome's `getTools()` hands the schema back as a JSON string; the polyfill hands back an object. */
function prettySchema(raw: unknown): string {
  const value = typeof raw === "string" ? tryParse(raw) : raw;
  try {
    return JSON.stringify(value ?? {}, null, 2) ?? "{}";
  } catch {
    return "{}";
  }
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function ToolRow({ tool }: { tool: ToolMirror }) {
  const { copied, copy } = useCopyFlash();
  const schema = useMemo(() => prettySchema(tool.inputSchema), [tool.inputSchema]);

  return (
    <li className="border-b border-hairline/70 px-4 py-3 last:border-0">
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{tool.title ?? tool.name}</p>
        <button
          type="button"
          onClick={() => copy(tool.name)}
          aria-label={`Copy the tool name ${tool.name}`}
          className="flex shrink-0 items-center gap-1 rounded-chip border border-hairline bg-plaster/60 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted transition-colors duration-200 ease-out-soft hover:text-ink"
        >
          {copied ? "copied" : tool.name}
          <IconCopy size={11} />
        </button>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">{tool.description}</p>
      <details className="mt-2 group/schema">
        <summary className="label-caps cursor-pointer list-none select-none text-[10px] transition-colors duration-200 ease-out-soft hover:text-ink">
          Schema
        </summary>
        <pre className="mt-1.5 max-h-[196px] overflow-auto rounded-chip border border-hairline bg-canvas-bottom/60 p-2 font-mono text-[11px] leading-snug whitespace-pre text-ink-muted panel-scroll">
          {schema}
        </pre>
      </details>
    </li>
  );
}

export function ToolsPanel({ toolGroups }: { toolGroups: Record<string, ToolGroup> }) {
  const open = useHearthStore((state) => state.ui.toolsPanelOpen);
  const available = useHearthStore((state) => state.tools.available);
  const status = useHearthStore((state) => state.tools.status);

  const grouped = useMemo(() => {
    const buckets = new Map<ToolGroup, ToolMirror[]>();
    for (const tool of available) {
      const group = toolGroups[tool.name] ?? "core";
      const bucket = buckets.get(group);
      if (bucket) bucket.push(tool);
      else buckets.set(group, [tool]);
    }
    return GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
      group,
      tools: buckets.get(group) ?? [],
    }));
  }, [available, toolGroups]);

  if (!open) return null;

  return (
    <aside
      aria-label="Agent tools registered on this page"
      className="glass-solid rise-in pointer-events-auto absolute right-0 bottom-0 z-40 flex max-h-[min(60vh,540px)] w-[424px] flex-col overflow-hidden"
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-hairline px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="label-caps">Agent tools</h2>
          <span className="numerals text-[13px] text-ink">{available.length}</span>
          <span className="label-caps text-[10px] text-ink-faint">
            {status === "native" ? "native WebMCP" : status === "polyfill" ? "polyfill" : status}
          </span>
        </div>
        <IconButton
          icon={IconClose}
          label="Close the tools panel"
          size="sm"
          onClick={() => hearthStore.getState().setUi({ toolsPanelOpen: false })}
        />
      </header>

      {grouped.length > 0 ? (
        <p className="label-caps shrink-0 border-b border-hairline px-4 py-2 text-[10px]">
          {grouped.map(({ group, tools }, index) => (
            <span key={group}>
              {index > 0 ? " · " : ""}
              {GROUP_LABELS[group]} <span className="numerals text-ink">{tools.length}</span>
            </span>
          ))}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto panel-scroll">
        {grouped.length === 0 ? (
          <EmptyState
            title="No tools are registered yet."
            hint="Open Hearth in a browser with WebMCP enabled and the studio registers 26 tools before first paint."
          />
        ) : (
          grouped.map(({ group, tools }) => (
            <section key={group}>
              <div className="sticky top-0 z-10 flex items-baseline gap-2 border-y border-hairline bg-plaster px-4 py-2">
                <h3 className="label-caps">{GROUP_LABELS[group]}</h3>
                <span className="numerals text-[12px] text-ink-muted">{tools.length}</span>
                {GROUP_GATES[group] ? (
                  <span className="truncate text-[11px] text-ink-faint">{GROUP_GATES[group]}</span>
                ) : null}
              </div>
              <ul>
                {tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
