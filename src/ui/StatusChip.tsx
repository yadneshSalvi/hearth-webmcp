"use client";
/**
 * Honest status. The chip reads the store's mirror of `document.modelContext`, so what it says is
 * exactly what an agent would find registered on this page (TOOLS.md §4) — including the count when
 * the polyfill is standing in for native WebMCP, which is the number the human actually wants.
 * Beside it, a menu with the three things a human can do about that: inspect the tools, connect a
 * real agent, or open the fallback assistant.
 *
 * Below 640 px the prefix is dropped from the visible text (the count is the part that changes) but
 * never from the accessible name.
 */
import { useState } from "react";
import { hearthStore, useHearthStore } from "../state/store";
import { IconAssistant, IconChevronUp, IconInfo, IconTools } from "./icons";
import { Popover } from "./primitives";
import type { IconProps } from "./icons";
import type { ComponentType } from "react";

function MenuItem({
  icon: Icon,
  label,
  hint,
  active,
  onSelect,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  hint: string;
  active?: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-chip px-2 py-2 text-left transition-colors duration-200 ease-out-soft hover:bg-charcoal/6 ${
        active ? "bg-terracotta/10" : ""
      }`}
    >
      <Icon size={15} className={`mt-0.5 shrink-0 ${active ? "text-terracotta" : "text-ink-muted"}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-ink">{label}</span>
        <span className="text-[11px] leading-snug text-ink-muted">{hint}</span>
      </span>
    </button>
  );
}

export function StatusChip({ className = "" }: { className?: string }) {
  const status = useHearthStore((state) => state.tools.status);
  const count = useHearthStore((state) => state.tools.available.length);
  const open = useHearthStore((state) => state.ui.toolsPanelOpen);
  const assistantOpen = useHearthStore((state) => state.ui.assistantOpen);
  const [menu, setMenu] = useState(false);

  const unavailable = status === "unavailable";
  const detail = status === "native"
    ? `${count} ready`
    : status === "polyfill"
      ? `${count} ready · polyfill`
      : unavailable
        ? "unavailable — enable"
        : "connecting…";

  const dot = status === "native"
    ? "bg-sage"
    : status === "polyfill"
      ? "bg-dusty-blue"
      : unavailable
        ? "bg-amber"
        : "bg-ink-faint breathe";

  const openAssistant = (): void => {
    setMenu(false);
    hearthStore.getState().setUi({ assistantOpen: true, cartOpen: false, inspectorCollapsed: false });
  };

  return (
    <div className={`glass relative flex h-9 shrink-0 items-center rounded-pill ${className}`}>
      <button
        type="button"
        aria-label={`Agent tools · ${detail}`}
        aria-expanded={unavailable ? undefined : open}
        onClick={() => hearthStore.getState().setUi(unavailable ? { enableSheetOpen: true } : { toolsPanelOpen: !open })}
        className="flex h-9 min-w-0 items-center gap-2 rounded-pill pr-1.5 pl-3 transition-colors duration-200 ease-out-soft hover:bg-plaster"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-pill ${dot}`} aria-hidden="true" />
        <IconTools size={15} className="shrink-0 text-ink-muted" />
        <span className="truncate text-[12px] whitespace-nowrap text-ink">
          <span className="hidden sm:inline">Agent tools · </span>
          {detail}
        </span>
      </button>
      <button
        type="button"
        aria-label="Agent options"
        aria-expanded={menu}
        onClick={() => setMenu((value) => !value)}
        className="flex h-9 shrink-0 items-center rounded-pill pr-2.5 pl-1 text-ink-faint transition-colors duration-200 ease-out-soft hover:bg-plaster hover:text-ink"
      >
        <IconChevronUp size={14} />
      </button>
      <Popover open={menu} onClose={() => setMenu(false)} label="Agent options" align="right" side="top" solid width={276}>
        <MenuItem
          icon={IconTools}
          label="Agent tools"
          hint={count > 0 ? `The ${count} tools registered on this page, with schemas` : "Nothing is registered on this page yet"}
          active={open}
          onSelect={() => {
            setMenu(false);
            hearthStore.getState().setUi({ toolsPanelOpen: !open });
          }}
        />
        <MenuItem
          icon={IconAssistant}
          label="Hearth Assistant (fallback)"
          hint="No agent attached? Drive the same tools from this page."
          active={assistantOpen}
          onSelect={openAssistant}
        />
        <MenuItem
          icon={IconInfo}
          label="Connect a real agent"
          hint="ChatGPT desktop, a Chrome flag, or the origin trial"
          onSelect={() => {
            setMenu(false);
            hearthStore.getState().setUi({ enableSheetOpen: true });
          }}
        />
      </Popover>
    </div>
  );
}
