"use client";
/**
 * One conflict, stated as a diagram legend rather than an alarm: the glyph matches the floor
 * overlay, the detail carries the cm, and the fix is one copyable sentence for the agent.
 */
import type { Conflict } from "../engine/types";
import { hearthStore } from "../state/store";
import { useCopyFlash } from "./clipboard";
import { conflictLabel } from "./format";
import { ConflictIcon, IconCopy } from "./icons";
import { Button } from "./primitives";

export function ConflictRow({ conflict }: { conflict: Conflict }) {
  const { copied, copy } = useCopyFlash();
  const error = conflict.severity === "error";

  return (
    <li
      onPointerEnter={() => hearthStore.getState().setUi({ pulseIds: conflict.items })}
      onPointerLeave={() => hearthStore.getState().setUi({ pulseIds: [] })}
      className={`flex flex-col gap-2 rounded-chip border p-2.5 ${
        error ? "border-rose/35 bg-rose/8" : "border-amber/35 bg-amber/8"
      }`}
    >
      <div className="flex items-start gap-2">
        <ConflictIcon kind={conflict.kind} size={16} className={`mt-0.5 shrink-0 ${error ? "text-rose" : "text-amber"}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[12px] font-medium text-ink">{conflictLabel(conflict.kind)}</p>
          <p className="text-[12px] leading-snug text-ink-muted">{conflict.detail}</p>
          <p className="text-[11.5px] leading-snug text-ink-muted">Fix · {conflict.fix}</p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon={IconCopy}
        onClick={() => copy(`Fix: ${conflict.fix}`)}
        className="self-start"
      >
        {copied ? "Copied — paste into ChatGPT" : "Ask agent to fix"}
      </Button>
    </li>
  );
}
