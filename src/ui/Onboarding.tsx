"use client";
/**
 * First-run card. It says one true thing about this page — whether an agent can see it — and then
 * gets out of the way. Dismissal is remembered in localStorage.
 */
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

  return (
    <div className={`glass rise-in pointer-events-auto flex w-[420px] items-start gap-3 p-4 ${className}`}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-terracotta/12 text-terracotta">
        <IconAgent size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-display text-[16px] leading-tight text-ink">
          {connected ? "Your agent can see this room" : "Your agent can’t see this room yet"}
        </p>
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {connected
            ? `Hearth has registered ${count} tools on this page. Ask your agent to place, arrange, measure or shop — every move shows up here with a receipt.`
            : "Hearth publishes its tools on document.modelContext. Connect through ChatGPT’s built-in browser, a Chrome flag, or the production origin trial."}
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
