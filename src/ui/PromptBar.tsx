"use client";
/**
 * The prompt bar teaches the collaboration. Four chips, computed from the room in front of you;
 * clicking one copies it so it can be pasted into ChatGPT or any WebMCP client.
 */
import { useMemo } from "react";
import { createCatalog } from "../engine/catalog";
import { useHearthStore } from "../state/store";
import { useCopyFlash } from "./clipboard";
import { IconAgent } from "./icons";
import { Kbd } from "./primitives";
import { promptSuggestions } from "./prompts";
import { useConflicts } from "./useHearth";

function PromptChip({ prompt }: { prompt: string }) {
  const { copied, copy } = useCopyFlash();
  return (
    <button
      type="button"
      data-prompt-chip
      onClick={() => copy(prompt)}
      title={prompt}
      className={`flex h-9 min-w-0 flex-auto items-center justify-center rounded-pill border px-2.5 transition-colors duration-200 ease-out-soft ${
        copied
          ? "border-sage/45 bg-sage/14 text-ink"
          : "border-hairline bg-plaster/55 text-ink-muted hover:border-charcoal/22 hover:bg-plaster hover:text-ink"
      }`}
    >
      <span className="font-display truncate text-[12.5px] italic">
        {copied ? "Copied — paste into ChatGPT" : `“${prompt}”`}
      </span>
    </button>
  );
}

export function PromptBar({ className = "" }: { className?: string }) {
  const scene = useHearthStore((state) => state.scene);
  const catalogItems = useHearthStore((state) => state.catalog);
  const cartLines = useHearthStore((state) => state.cart.lines.length);
  const conflicts = useConflicts();

  const prompts = useMemo(() => {
    const room = scene.rooms.find((candidate) => candidate.id === scene.meta.activeRoomId) ?? scene.rooms[0];
    const selected = scene.furniture.find((item) => item.id === scene.meta.selection.itemId);
    const product = selected ? createCatalog(catalogItems).byId(selected.catalogId) : undefined;
    return promptSuggestions({
      mode: scene.meta.mode,
      roomName: room?.name ?? "room",
      ...(product ? { selectionName: product.name } : {}),
      conflictKinds: conflicts.map((conflict) => conflict.kind),
      cartLines,
      variants: scene.variants.filter((variant) => variant.roomId === scene.meta.activeRoomId).length,
      accessibility: scene.meta.accessibilityMode,
    });
  }, [scene, catalogItems, conflicts, cartLines]);

  return (
    <div className={`glass pointer-events-auto flex h-14 shrink-0 items-center gap-2 px-3.5 ${className}`}>
      <IconAgent size={16} className="shrink-0 text-terracotta" />
      <span className="label-caps hidden shrink-0 xl:inline">Try asking your agent</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {prompts.map((prompt) => (
          <PromptChip key={prompt} prompt={prompt} />
        ))}
      </div>
      <span className="hidden shrink-0 items-center gap-1 xl:flex">
        <Kbd>⌘K</Kbd>
      </span>
    </div>
  );
}
