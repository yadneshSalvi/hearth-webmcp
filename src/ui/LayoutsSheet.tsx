"use client";
/**
 * The Layouts chooser: every floor plan the engine ships, as a mini plan you can read before you
 * commit to it. Reachable from the top bar in every mode — the Build panel's segmented picker stays
 * where it is for people already editing walls.
 *
 * Applying one goes through `applyTemplate` (src/ui/buildOps.ts), the same path the Build panel and
 * the agent's tool use: it asks first when placed furniture would be lost, toasts, and offers Undo.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { TemplateId } from "../engine/types";
import { hearthStore, useHearthStore } from "../state/store";
import { palette } from "../tokens";
import { applyTemplate } from "./buildOps";
import { IconCheck, IconUpload } from "./icons";
import { Button, Chip, Tag } from "./primitives";
import { Sheet } from "./Sheet";
import { templateCards } from "./templates";

/**
 * The mini plan's drawing box. The svg scales to whatever the card is wide, so these are the plan's
 * own coordinates and its aspect, not a pixel size; `PLAN_BOX` is how tall it is actually drawn.
 */
const PLAN_W = 210;
const PLAN_H = 128;
/**
 * All seven layouts have to be readable without scrolling, and the shortest supported window is
 * 1280 × 800: three rows of cards plus the header, the toggle and the footnote fit inside 84 vh
 * there when the plan is drawn 80 px tall and the card pads on the 8 px step. A taller window simply
 * gets more air.
 */
const PLAN_BOX = 80;
/** Three columns need the wider sheet; below that the grid falls back to two, and to one on a phone. */
const WIDE_MIN_PX = 1200;
const SHEET_WIDE = 780;
const SHEET_NARROW = 588;

/** True while the window is wide enough for three columns of cards. */
function useWideSheet(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(`(min-width: ${WIDE_MIN_PX}px)`);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(`(min-width: ${WIDE_MIN_PX}px)`).matches,
    () => true,
  );
}

export interface LayoutsSheetProps {
  open: boolean;
  onClose(): void;
}

export function LayoutsSheet({ open, onClose }: LayoutsSheetProps) {
  const current = useHearthStore((state) => state.scene.meta.template);
  // The confirmation gate is the topmost thing on the page while it is up (this sheet is portalled
  // to the body, so DOM order alone would paint it over the question). The chooser steps aside and
  // comes back if the human keeps their home; its `furnished` choice survives, hooks and all.
  const confirming = useHearthStore((state) => state.ui.pendingConfirm !== undefined);
  const [furnished, setFurnished] = useState(true);
  const [applying, setApplying] = useState<TemplateId | undefined>(undefined);
  const cards = useMemo(() => templateCards(PLAN_W, PLAN_H), []);
  const wide = useWideSheet();

  const choose = async (id: TemplateId): Promise<void> => {
    if (applying) return;
    setApplying(id);
    const before = hearthStore.getState().scene;
    try {
      await applyTemplate(id, furnished);
    } finally {
      setApplying(undefined);
    }
    // The confirmation gate may have been declined, in which case the home is untouched and the
    // chooser stays open on the card the human was looking at.
    if (hearthStore.getState().scene !== before) onClose();
  };

  if (!open || confirming || typeof document === "undefined") return null;

  return createPortal(
    <Sheet
      open={open}
      onClose={onClose}
      title="Layouts"
      subtitle="Start from a floor plan."
      width={wide ? SHEET_WIDE : SHEET_NARROW}
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2">
          {/* The first thing to answer is "furnished?", so it takes the focus the sheet hands out and
              the tab order reads toggle → cards → close rather than starting on the close button. */}
          <Chip
            active={furnished}
            icon={furnished ? IconCheck : undefined}
            data-autofocus=""
            onClick={() => setFurnished(!furnished)}
          >
            Furnished
          </Chip>
          <span className="text-[11.5px] leading-snug text-ink-faint">
            {furnished ? "Arrives with furniture placed." : "Arrives as empty rooms."}
          </span>
          <span className="flex-1" />
          {/* The eighth plan is the human's own: a floor-plan image, read and built to scale. */}
          <Button size="sm" icon={IconUpload} data-import-plan="" onClick={() => { onClose(); hearthStore.getState().setUi({ importSheetOpen: true }); }}>
            Import your own plan
          </Button>
        </div>

        <ul role="list" className="grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-3">
          {cards.map((card) => {
            const isCurrent = card.id === current;
            return (
              <li key={card.id}>
                <button
                  type="button"
                  aria-label={`Apply the ${card.label} layout, ${furnished ? "furnished" : "empty"}`}
                  aria-current={isCurrent ? "true" : undefined}
                  disabled={applying !== undefined}
                  onClick={() => void choose(card.id)}
                  className="flex w-full flex-col gap-2 rounded-panel border border-hairline bg-plaster/55 p-2 text-left transition-colors duration-200 ease-out-soft hover:border-charcoal/24 hover:bg-plaster disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="flex items-center justify-center overflow-hidden rounded-chip border border-hairline bg-canvas-top">
                    <svg
                      viewBox={`0 0 ${card.plan.width} ${card.plan.height}`}
                      width="100%"
                      height={PLAN_BOX}
                      aria-hidden="true"
                      focusable="false"
                    >
                      {card.plan.rooms.map((room) => (
                        <polygon
                          key={room.id}
                          points={room.points}
                          fill={room.fill}
                          fillOpacity={0.62}
                          // Charcoal at a third, like plan view's own wall band: at 14 % the
                          // hairline disappears at this scale and the rooms merge into one blob.
                          stroke={palette.charcoal}
                          strokeOpacity={0.34}
                          strokeWidth={1}
                        />
                      ))}
                    </svg>
                  </span>
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="font-display text-[15px] leading-tight text-ink">{card.label}</span>
                      <span className="numerals text-[11.5px] leading-snug text-ink-muted">
                        {card.spec}
                        {/* The Furnished choice is made once at the top and applies to every card,
                            so each card says which of the two homes it would actually build. */}
                        <span className="text-ink-faint"> · {furnished ? "furnished" : "empty"}</span>
                      </span>
                    </span>
                    {isCurrent ? <Tag tone="terracotta">Current</Tag> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="text-[11.5px] leading-snug text-ink-muted">
          A layout replaces every room. You will be asked first if there is furniture to lose, and the
          toast that follows can undo it.
        </p>
      </div>
    </Sheet>,
    document.body,
  );
}
