"use client";
/**
 * First-run card. It says one true thing about this page — whether an agent can see it — and then
 * gets out of the way. Dismissal is remembered in localStorage.
 *
 * Escape dismisses it, like every other overlay in the studio: it is the topmost thing on the page
 * on a first visit, so Escape has to mean this card before it can mean anything else.
 */
import { useEffect } from "react";
import { hearthStore, useHearthStore } from "../state/store";
import { IconAgent, IconClose, IconTools } from "./icons";
import { Button, IconButton } from "./primitives";
import type { WebMCPStatus } from "../tools/useWebMCP";

export function Onboarding({
  status,
  onDismiss,
  className = "",
}: {
  status: WebMCPStatus;
  onDismiss(): void;
  className?: string;
}) {
  const count = useHearthStore((state) => state.tools.available.length);
  const connected = status === "native" || status === "polyfill";

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // A sheet opened from this card (How to connect / See the tools) owns Escape while it is up,
      // and inside a text field Escape belongs to the field (BuildPanel resets a room name with it).
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.stopPropagation();
      onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className={`glass rise-in pointer-events-auto flex w-[420px] items-start gap-3 p-4 ${className}`}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-terracotta/12 text-terracotta">
        <IconAgent size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-display text-[16px] leading-tight text-ink">
          {connected ? "Your agent can see this room" : "No agent can see this room yet"}
        </p>
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {connected
            ? `${count} tools are registered on this page. Ask your agent to place, arrange, measure or shop — every move lands in the log with its receipt.`
            : "Hearth publishes its tools on document.modelContext. Connect ChatGPT or Chrome — or let the built-in assistant stand in."}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant={connected ? "secondary" : "primary"}
            size="sm"
            icon={IconTools}
            onClick={() => hearthStore.getState().setUi(connected ? { toolsPanelOpen: true } : { enableSheetOpen: true })}
          >
            {connected ? "See the tools" : "How to connect"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Start designing
          </Button>
        </div>
      </div>
      <IconButton icon={IconClose} label="Dismiss the welcome card" size="sm" onClick={onDismiss} />
    </div>
  );
}
