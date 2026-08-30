"use client";
/**
 * The confirmation gate for destructive tools (TOOLS.md §0). The dialog states the tool's own
 * question, the hairline counts down the 45 s the registry allows, and Escape declines.
 */
import { useEffect, useState } from "react";
import { useHearthStore } from "../state/store";
import { confirmLabel, plural } from "./format";
import { Button } from "./primitives";
import { Sheet } from "./Sheet";
import { confirmAttribution } from "./toolUi";
import { toolUi } from "./useHearth";

const TIMEOUT_S = 45;

/**
 * The line under the question: who asked, and what it costs. A human choosing a layout from the
 * Layouts sheet is not "your agent", and a home with furniture in it should say how much is at stake
 * before the button is pressed.
 */
function subtitleFor(by: "human" | "agent", placed: number): string {
  const stake = placed > 0
    ? `${plural(placed, "placed item")} will go; undo brings them back.`
    : "Undo restores it either way.";
  return by === "agent" ? `Your agent asked for this. ${stake}` : stake;
}

/** Keyed by the confirmation id, so a new question starts a fresh countdown by remounting. */
function Countdown() {
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_S);

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="h-px w-full overflow-hidden bg-hairline" aria-hidden="true">
        <div
          className="h-full bg-terracotta transition-[width] duration-500 ease-out-soft"
          style={{ width: `${(secondsLeft / TIMEOUT_S) * 100}%` }}
        />
      </div>
      <p className="label-caps text-[10px]">{secondsLeft > 0 ? `${secondsLeft} s to answer` : "Timed out"}</p>
    </div>
  );
}

export function ConfirmModal() {
  const pending = useHearthStore((state) => state.ui.pendingConfirm);
  const placed = useHearthStore(
    (state) => state.scene.furniture.filter((item) => item.status === "placed").length,
  );
  if (!pending) return null;

  const decline = (): void => toolUi.resolveConfirm(pending.id, false);

  return (
    <Sheet
      open
      onClose={decline}
      title={pending.message}
      subtitle={subtitleFor(confirmAttribution(), placed)}
      width={420}
      showClose={false}
      footer={
        <>
          <Button variant="secondary" onClick={decline}>Keep</Button>
          <Button variant="primary" data-autofocus="" onClick={() => toolUi.resolveConfirm(pending.id, true)}>
            {confirmLabel(pending.message)}
          </Button>
        </>
      }
    >
      <Countdown key={pending.id} />
    </Sheet>
  );
}
