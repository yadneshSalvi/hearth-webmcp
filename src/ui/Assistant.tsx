"use client";
/**
 * The Hearth Assistant — the *fallback* agent, for a browser with no WebMCP client attached.
 *
 * It is the same collaboration, not a second one: every reply is produced by calling the tools
 * registered on `document.modelContext`, so the orb flies, the item pulses and the receipt lands in
 * the activity log exactly as it would for ChatGPT or Chrome (TOOLS.md §0, §4). The panel therefore
 * says out loud that native is primary, and shows the guardrails it runs under, in the loop's own
 * numbers: up to `DEFAULT_MAX_CALLS_PER_TURN` tool calls per turn, and destructive tools still open
 * the confirmation dialog.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCatalog } from "../engine/catalog";
import { hearthStore, useHearthStore } from "../state/store";
import { createAssistant } from "./assistantClient";
import type { AssistantEvents, AssistantSession } from "./assistantClient";
import { assistantToolsSettled, ensureAssistantTools, executeAssistantTool } from "./assistantTools";
import {
  MAX_CALLS_PER_TURN, callCapLine, callCapSentence, callCapSpent, capReached, dispatchAssistant,
  plainText, retryableTurn, useAssistantState,
} from "./assistantStore";
import type { AssistantMessage, AssistantToolCall } from "./assistantStore";
import { compactJson, splitNumerals } from "./format";
import { IconAgent, IconAssistant, IconChevronDown, IconChevronRight, IconClose, IconRedo, IconTools } from "./icons";
import { Button, IconButton, Kbd, Panel } from "./primitives";
import { promptSuggestions } from "./prompts";
import { shopify, toolUi, useConflicts } from "./useHearth";

/** Sets measurements and prices in Fraunces tabular numerals inside an Inter sentence. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {splitNumerals(plainText(text)).map((run, index) => (
        <span key={`${index}-${run.text}`} className={run.numeric ? "numerals" : undefined}>
          {run.text}
        </span>
      ))}
    </>
  );
}

function close(): void {
  hearthStore.getState().setUi({ assistantOpen: false });
}

/**
 * Points at the receipt this call wrote. The activity log occupies the same slot as the panel, so
 * revealing a row means handing the column back to it and focusing the row.
 */
function revealReceipt(receiptId: string): void {
  close();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`[data-receipt-id="${CSS.escape(receiptId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    row?.querySelector<HTMLElement>("button")?.focus();
  }));
}

/** One inline tool-call chip: "Placed Endre Sofa · 120 ms", opening to the exact input and result. */
function ToolChip({ call }: { call: AssistantToolCall }) {
  const [open, setOpen] = useState(false);
  const running = call.result === undefined;
  const failed = call.ok === false;
  const label = call.summary ?? call.name;
  const skin = running
    ? "border-hairline bg-plaster/60 text-ink-muted"
    : failed
      ? "border-amber/45 bg-amber/10 text-ink"
      : "border-terracotta/35 bg-terracotta/8 text-ink";

  return (
    <li className="flex flex-col">
      <button
        type="button"
        data-assistant-chip
        disabled={running}
        aria-expanded={running ? undefined : open}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-1.5 rounded-chip border px-2 py-1.5 text-left transition-colors duration-200 ease-out-soft disabled:cursor-default ${skin}`}
      >
        {running ? (
          <span className="breathe h-1.5 w-1.5 shrink-0 rounded-pill bg-terracotta" aria-hidden="true" />
        ) : (
          <IconTools size={13} className="shrink-0 text-terracotta" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px]">
          <Prose text={label} />
        </span>
        {call.ms !== undefined ? (
          <span className="numerals shrink-0 text-[11px] text-ink-muted">{call.ms} ms</span>
        ) : (
          <span className="label-caps shrink-0 text-[9.5px]">running</span>
        )}
        {running ? null : open ? (
          <IconChevronDown size={13} className="shrink-0 text-ink-faint" />
        ) : (
          <IconChevronRight size={13} className="shrink-0 text-ink-faint" />
        )}
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-col gap-1.5 rounded-chip border border-hairline bg-plaster/55 p-2">
          <p className="label-caps text-[9.5px]">{call.name} · input</p>
          <pre className="max-h-[96px] overflow-auto rounded-chip border border-hairline bg-canvas-bottom/50 p-1.5 font-mono text-[10.5px] leading-snug text-ink-muted panel-scroll">
            {compactJson(call.input)}
          </pre>
          <p className="label-caps text-[9.5px]">Result</p>
          <pre className="max-h-[180px] overflow-auto rounded-chip border border-hairline bg-canvas-bottom/50 p-1.5 font-mono text-[10.5px] leading-snug text-ink-muted panel-scroll">
            {compactJson(call.result)}
          </pre>
          {call.receiptId ? (
            <Button variant="ghost" size="sm" className="self-start px-0" onClick={() => revealReceipt(call.receiptId ?? "")}>
              Show receipt in the activity log
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Turn({ message, onRetry }: { message: AssistantMessage; onRetry(): void }) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[86%] rounded-chip border border-hairline bg-plaster px-2.5 py-1.5 text-[12.5px] leading-relaxed text-ink">
          <Prose text={message.text} />
        </p>
      </li>
    );
  }

  const streaming = message.status === "streaming";
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-plum/12 text-plum">
        <IconAssistant size={13} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {message.text.length > 0 || streaming ? (
          <p className="text-[12.5px] leading-relaxed text-ink">
            <Prose text={message.text} />
            {streaming ? (
              <span
                aria-hidden="true"
                className="caret ml-px inline-block h-[0.95em] w-[2px] translate-y-[2px] rounded-pill bg-terracotta"
              />
            ) : null}
          </p>
        ) : null}
        {message.calls.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {message.calls.map((call) => (
              <ToolChip key={call.id} call={call} />
            ))}
          </ul>
        ) : null}
        {message.status === "stopped" ? <p className="label-caps text-[9.5px]">stopped</p> : null}
        {message.error ? (
          <div className="flex flex-col items-start gap-1.5 rounded-chip border border-amber/45 bg-amber/10 p-2">
            <p className="text-[12px] leading-snug text-ink">{message.error.message}</p>
            {message.error.retryable ? (
              <Button variant="secondary" size="sm" icon={IconRedo} onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The empty state: what this panel is, what it is not, and four prompts true of this room. */
function Opening({ prompts, onPick }: { prompts: string[]; onPick(prompt: string): void }) {
  const tools = useHearthStore((state) => state.tools.available.length);
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3">
      <p className="font-display text-[15px] leading-snug italic text-ink-muted">
        No agent in the room? I can stand in.
      </p>
      <p className="text-[12px] leading-relaxed text-ink-muted">
        ChatGPT or Chrome over WebMCP is the real thing; this is the fallback. It calls the same{" "}
        <span className="numerals text-ink">{tools > 0 ? tools : 26}</span> tools on{" "}
        <code className="font-mono text-[11px] text-ink">document.modelContext</code> — every move lands in the log.
      </p>
      <p className="label-caps text-[10px]">Try</p>
      <div className="flex flex-col gap-1">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            data-assistant-starter
            onClick={() => onPick(prompt)}
            className="rounded-chip border border-hairline bg-plaster/55 px-2.5 py-1 text-left transition-colors duration-200 ease-out-soft hover:border-charcoal/22 hover:bg-plaster"
          >
            <span className="font-display text-[12.5px] italic text-ink-muted">“{prompt}”</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Four prompts that are true of the room in front of the human, shared with the prompt bar. */
function useStarterPrompts(): string[] {
  const scene = useHearthStore((state) => state.scene);
  const catalogItems = useHearthStore((state) => state.catalog);
  const cartLines = useHearthStore((state) => state.cart.lines.length);
  const conflicts = useConflicts();
  return useMemo(() => {
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
}

export function Assistant({ className = "" }: { className?: string }) {
  const state = useAssistantState();
  const prompts = useStarterPrompts();
  const [draft, setDraft] = useState("");
  const loop = useRef<AssistantSession | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const retry = retryableTurn(state);

  // Opening the panel is the explicit opt-in to the polyfill: the chip flips to "polyfill" here,
  // before the first message, so the human sees where the tools came from.
  useEffect(() => {
    void ensureAssistantTools({ ui: toolUi, shopify });
    input.current?.focus({ preventScroll: true });
  }, []);

  // Follow the stream, but only while the human has not scrolled up to read something.
  useEffect(() => {
    const node = scroller.current;
    if (!node || state.messages.length === 0) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 120) node.scrollTop = node.scrollHeight;
  }, [state.messages]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setDraft("");
    dispatchAssistant({ type: "send", text: trimmed });
    const events: AssistantEvents = {
      onText: (delta) => void dispatchAssistant({ type: "text", delta }),
      onToolCall: (call) => void dispatchAssistant({ type: "call", id: call.id, name: call.name, input: call.input }),
      onToolResult: (call) => {
        // The registry writes the receipt before the promise resolves (TOOLS.md §0), so the newest
        // row for this tool is this call's row — the chip and the log then share one identity.
        const receipt = hearthStore.getState().activity.find((entry) => entry.tool === call.name);
        dispatchAssistant({
          type: "result",
          id: call.id,
          result: call.result,
          ms: call.ms,
          ...(receipt ? { receiptId: receipt.id, summary: receipt.summary } : {}),
        });
      },
      onDone: (turn) => void dispatchAssistant({ type: "done", text: turn.text, calls: turn.calls }),
      onError: (error) => void dispatchAssistant({ type: "error", message: error.message, retryable: error.retryable }),
    };
    void ensureAssistantTools({ ui: toolUi, shopify }).then(() => {
      // `execute` routes every call through Hearth's own registry as the assistant, so the receipt
      // is filed in plum rather than as an agent's work (src/ui/assistantTools.ts).
      loop.current ??= createAssistant({ maxCallsPerTurn: MAX_CALLS_PER_TURN, execute: executeAssistantTool, settle: assistantToolsSettled });
      return loop.current.send(trimmed, events);
    }).catch((error: unknown) => {
      dispatchAssistant({
        type: "error",
        message: error instanceof Error ? error.message : "The assistant could not finish that turn.",
        retryable: true,
      });
    });
  }, []);

  const stop = (): void => {
    loop.current?.abort();
    dispatchAssistant({ type: "stop" });
  };

  return (
    // Escape closes the panel from anywhere inside it, including the composer.
    <div
      className={`flex min-h-0 flex-col ${className}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        close();
      }}
    >
    <Panel
      label="Hearth Assistant"
      className="min-h-0 flex-1"
      actions={
        <>
          <span className="label-caps rounded-pill border border-hairline bg-plaster/70 px-1.5 py-0.5 text-[9.5px]">
            fallback
          </span>
          {state.running || state.callsThisTurn > 0 ? (
            <span className="numerals text-[11px] text-ink-muted" title="Tool calls used by this turn">
              {state.callsThisTurn}/{state.maxCallsPerTurn}
            </span>
          ) : null}
          <IconButton icon={IconClose} label="Close the Hearth Assistant" size="sm" onClick={close} />
        </>
      }
      flush
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="assistant-input">Message the Hearth Assistant</label>
            <textarea
              id="assistant-input"
              ref={input}
              rows={1}
              value={draft}
              placeholder="Ask about this room…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
                event.preventDefault();
                if (!state.running) send(draft);
              }}
              className="max-h-[86px] min-h-9 flex-1 resize-none rounded-chip border border-hairline bg-plaster/70 px-2.5 py-2 text-[12.5px] leading-snug text-ink outline-none transition-colors duration-200 ease-out-soft placeholder:text-ink-faint focus:border-ochre/60"
            />
            {state.running ? (
              <Button variant="secondary" size="sm" onClick={stop}>Stop</Button>
            ) : (
              <Button variant="primary" size="sm" disabled={draft.trim().length === 0} onClick={() => send(draft)}>
                Send
              </Button>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-[10.5px] leading-none text-ink-faint">
            <IconAgent size={11} className="shrink-0" />
            <span
              className="min-w-0 flex-1 truncate"
              title={callCapSentence(state.maxCallsPerTurn)}
            >
              {capReached(state) ? callCapSpent(state.maxCallsPerTurn) : callCapLine(state.maxCallsPerTurn)}
            </span>
            <Kbd>⌘↩</Kbd>
          </p>
        </div>
      }
    >
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto panel-scroll">
        {state.messages.length === 0 ? (
          <Opening prompts={prompts} onPick={send} />
        ) : (
          <ul
            role="log"
            aria-label="Hearth Assistant transcript"
            aria-live="polite"
            aria-busy={state.running}
            className="flex flex-col gap-3 px-3.5 py-3"
          >
            {state.messages.map((message) => (
              <Turn
                key={message.id}
                message={message}
                onRetry={() => {
                  if (retry) send(retry);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
    </div>
  );
}
