"use client";
/**
 * The confirmation gate for destructive tools (TOOLS.md §0). The dialog states the tool's own
 * question, the hairline counts down the 45 s the registry allows, and Escape declines.
 */
import { useEffect, useState } from "react";
import { useHearthStore } from "../state/store";
import { confirmLabel } from "./format";
import { Button } from "./primitives";
import { Sheet } from "./Sheet";
import { toolUi } from "./useHearth";

const TIMEOUT_S = 45;

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
  if (!pending) return null;

  const decline = (): void => toolUi.resolveConfirm(pending.id, false);

  return (
    <Sheet
      open
      onClose={decline}
      title={pending.message}
      subtitle="Your agent asked for this. Undo restores it either way."
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
