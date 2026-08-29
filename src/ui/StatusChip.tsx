"use client";
/**
 * Honest status. The chip reads the store's mirror of `document.modelContext`, so what it says is
 * exactly what an agent would find registered on this page (TOOLS.md §4) — including the count when
 * the polyfill is standing in for native WebMCP, which is the number the human actually wants.
 *
 * Below 640 px the prefix is dropped from the visible text (the count is the part that changes) but
 * never from the accessible name.
 */
import { hearthStore, useHearthStore } from "../state/store";
import { IconTools } from "./icons";

export function StatusChip({ className = "" }: { className?: string }) {
  const status = useHearthStore((state) => state.tools.status);
  const count = useHearthStore((state) => state.tools.available.length);
  const open = useHearthStore((state) => state.ui.toolsPanelOpen);

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

  return (
    <button
      type="button"
      aria-label={`Agent tools · ${detail}`}
      aria-expanded={unavailable ? undefined : open}
      onClick={() => hearthStore.getState().setUi(unavailable ? { enableSheetOpen: true } : { toolsPanelOpen: !open })}
      className={`glass flex h-9 shrink-0 items-center gap-2 rounded-pill px-3 transition-colors duration-200 ease-out-soft hover:bg-plaster ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-pill ${dot}`} aria-hidden="true" />
      <IconTools size={15} className="shrink-0 text-ink-muted" />
      <span className="truncate text-[12px] whitespace-nowrap text-ink">
        <span className="hidden sm:inline">Agent tools · </span>
        {detail}
      </span>
    </button>
  );
}
