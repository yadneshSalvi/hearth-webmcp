"use client";
/**
 * Honest status. The chip reads the store's mirror of `document.modelContext`, so what it says is
 * exactly what an agent would find registered on this page (TOOLS.md §4).
 */
import { hearthStore, useHearthStore } from "../state/store";
import { IconTools } from "./icons";

export function StatusChip({ className = "" }: { className?: string }) {
  const status = useHearthStore((state) => state.tools.status);
  const count = useHearthStore((state) => state.tools.available.length);
  const open = useHearthStore((state) => state.ui.toolsPanelOpen);

  const unavailable = status === "unavailable";
  const label = status === "native"
    ? `Agent tools · ${count} ready`
    : status === "polyfill"
      ? "Agent tools · polyfill"
      : unavailable
        ? "Agent tools unavailable — enable"
        : "Agent tools · connecting…";

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
      aria-expanded={unavailable ? undefined : open}
      onClick={() => hearthStore.getState().setUi(unavailable ? { enableSheetOpen: true } : { toolsPanelOpen: !open })}
      className={`glass flex h-9 shrink-0 items-center gap-2 rounded-pill px-3 transition-colors duration-200 ease-out-soft hover:bg-plaster ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-pill ${dot}`} aria-hidden="true" />
      <IconTools size={15} className="shrink-0 text-ink-muted" />
      <span className="truncate text-[12px] text-ink">{label}</span>
    </button>
  );
}
