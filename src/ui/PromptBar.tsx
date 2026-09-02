"use client";
/**
 * The prompt bar teaches the collaboration. Four chips, computed from the room in front of you;
 * clicking one copies it so it can be pasted into ChatGPT or any WebMCP client.
 *
 * Below 1024 px the studio is view-only plus these prompts, and four chips sharing ~150 px each
 * truncated to an empty outline (STYLE.md §4: every state is designed). There the bar becomes one
 * Prompts button and the prompts get a sheet with room to be read.
 */
import { useMemo, useState } from "react";
import { productFor } from "../engine/catalog";
import { useHearthStore } from "../state/store";
import { HANDOFF_FLASH_MS, useCopyFlash } from "./clipboard";
import { IconAgent, IconCopy, IconHandoff } from "./icons";
import { Button, Kbd } from "./primitives";
import { promptSuggestions } from "./prompts";
import { Sheet } from "./Sheet";
import { useConflicts } from "./useHearth";
import type { ViewportTier } from "./useViewportTier";

/**
 * One chip. The click is the hand-off, so the confirmation has to be unmistakable: the chip turns
 * sage, the arrow says where the prompt is going, and it holds for 2.5 s — long enough to read
 * "paste into ChatGPT" and switch windows, rather than flashing past mid-sentence.
 */
function PromptChip({ prompt }: { prompt: string }) {
  const { copied, copy } = useCopyFlash(HANDOFF_FLASH_MS);
  return (
    <button
      type="button"
      data-prompt-chip
      onClick={() => copy(prompt)}
      title={prompt}
      className={`flex h-9 min-w-0 flex-auto items-center justify-center gap-1.5 rounded-pill border px-2.5 transition-colors duration-200 ease-out-soft ${
        copied
          ? "border-sage/45 bg-sage/14 text-ink"
          : "border-hairline bg-plaster/55 text-ink-muted hover:border-charcoal/22 hover:bg-plaster hover:text-ink"
      }`}
    >
      {copied ? <IconHandoff size={14} className="shrink-0 text-sage" /> : null}
      <span className="font-display truncate text-[12.5px] italic">
        {copied ? "Copied — paste into ChatGPT" : `“${prompt}”`}
      </span>
    </button>
  );
}

/** One full-width prompt row, wide enough to read the whole sentence on a phone. */
function PromptRow({ prompt }: { prompt: string }) {
  const { copied, copy } = useCopyFlash(HANDOFF_FLASH_MS);
  return (
    <li className="border-b border-hairline/70 last:border-0">
      <button
        type="button"
        data-prompt-chip
        onClick={() => copy(prompt)}
        className="flex w-full items-center gap-3 py-3 text-left transition-colors duration-200 ease-out-soft hover:bg-charcoal/4"
      >
        <span className="font-display flex-1 text-[14px] italic leading-snug text-ink">“{prompt}”</span>
        {copied ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] whitespace-nowrap text-ink">
            <IconHandoff size={15} className="text-sage" />
            Copied — paste into ChatGPT
          </span>
        ) : (
          <IconCopy size={16} className="shrink-0 text-ink-faint" />
        )}
      </button>
    </li>
  );
}

export function PromptBar({ className = "", tier = "full" }: { className?: string; tier?: ViewportTier }) {
  const scene = useHearthStore((state) => state.scene);
  const catalogItems = useHearthStore((state) => state.catalog);
  const cartLines = useHearthStore((state) => state.cart.lines.length);
  const uploadedPlan = useHearthStore((state) => state.ui.uploadedPlan !== undefined);
  const cleared = useHearthStore((state) => (state.ui.lastCleared?.furniture.length ?? 0) > 0);
  const conflicts = useConflicts();
  const [sheetOpen, setSheetOpen] = useState(false);
  const compact = tier === "compact";

  const prompts = useMemo(() => {
    const room = scene.rooms.find((candidate) => candidate.id === scene.meta.activeRoomId) ?? scene.rooms[0];
    const selected = scene.furniture.find((item) => item.id === scene.meta.selection.itemId);
    const product = selected ? productFor(selected, catalogItems) : undefined;
    return promptSuggestions({
      mode: scene.meta.mode,
      roomName: room?.name ?? "room",
      ...(product ? { selectionName: product.name } : {}),
      conflictKinds: conflicts.map((conflict) => conflict.kind),
      cartLines,
      variants: scene.variants.filter((variant) => variant.roomId === scene.meta.activeRoomId).length,
      accessibility: scene.meta.accessibilityMode,
      uploadedPlan,
      cleared,
    });
  }, [scene, catalogItems, conflicts, cartLines, uploadedPlan, cleared]);

  return (
    <div
      data-studio-inset=""
      className={`glass pointer-events-auto flex h-14 shrink-0 items-center gap-2 px-3.5 ${className}`}
    >
      <IconAgent size={16} className="shrink-0 text-terracotta" />
      <span className="label-caps hidden shrink-0 xl:inline">Try asking your agent</span>
      {compact ? (
        <>
          <Button variant="secondary" icon={IconCopy} className="min-w-0 flex-1" onClick={() => setSheetOpen(true)}>
            Prompts
          </Button>
          <Sheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="Ask your agent"
            subtitle="Copy one of these and paste it into ChatGPT or any WebMCP client."
            width={360}
          >
            <ul className="flex flex-col">
              {prompts.map((prompt) => (
                <PromptRow key={prompt} prompt={prompt} />
              ))}
            </ul>
          </Sheet>
        </>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {prompts.map((prompt) => (
            <PromptChip key={prompt} prompt={prompt} />
          ))}
        </div>
      )}
      <span className="hidden shrink-0 items-center gap-1 xl:flex">
        <Kbd>⌘K</Kbd>
      </span>
    </div>
  );
}
