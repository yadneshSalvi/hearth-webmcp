"use client";
/**
 * The Layouts chooser: every floor plan the engine ships, as a mini plan you can read before you
 * commit to it. Reachable from the top bar in every mode — the Build panel's segmented picker stays
 * where it is for people already editing walls.
 *
 * Applying one goes through `applyTemplate` (src/ui/buildOps.ts), the same path the Build panel and
 * the agent's tool use: it asks first when placed furniture would be lost, toasts, and offers Undo.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TemplateId } from "../engine/types";
import { hearthStore, useHearthStore } from "../state/store";
import { palette } from "../tokens";
import { applyTemplate } from "./buildOps";
import { IconCheck } from "./icons";
import { Chip, Tag } from "./primitives";
import { Sheet } from "./Sheet";
import { templateCards } from "./templates";

/** The mini plan's box, in px. Two of these plus the card padding make the 588 px sheet's grid. */
const PLAN_W = 210;
const PLAN_H = 128;

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
    <Sheet open={open} onClose={onClose} title="Layouts" subtitle="Start from a floor plan." width={588}>
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2">
          <Chip active={furnished} icon={furnished ? IconCheck : undefined} onClick={() => setFurnished(!furnished)}>
            Furnished
          </Chip>
          <span className="text-[11.5px] leading-snug text-ink-faint">
            {furnished ? "Arrives with furniture placed." : "Arrives as empty rooms."}
          </span>
        </div>

        <ul role="list" className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3">
          {cards.map((card) => {
            const isCurrent = card.id === current;
            return (
              <li key={card.id}>
                <button
                  type="button"
                  aria-label={`Apply the ${card.label} layout`}
                  aria-current={isCurrent ? "true" : undefined}
                  disabled={applying !== undefined}
                  onClick={() => void choose(card.id)}
                  className="flex w-full flex-col gap-2.5 rounded-panel border border-hairline bg-plaster/55 p-2.5 text-left transition-colors duration-200 ease-out-soft hover:border-charcoal/24 hover:bg-plaster disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="flex items-center justify-center overflow-hidden rounded-chip border border-hairline bg-canvas-top">
                    <svg
                      viewBox={`0 0 ${card.plan.width} ${card.plan.height}`}
                      width="100%"
                      height={card.plan.height}
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
                      <span className="numerals text-[11.5px] leading-snug text-ink-muted">{card.spec}</span>
                    </span>
                    {isCurrent ? <Tag tone="terracotta">Current</Tag> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="text-[11.5px] leading-snug text-ink-muted">
          A layout replaces every room in the home. You will be asked first if there is furniture to lose,
          and the toast that follows can undo it.
        </p>
      </div>
    </Sheet>,
    document.body,
  );
}
