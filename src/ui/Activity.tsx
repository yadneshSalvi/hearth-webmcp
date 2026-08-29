"use client";
/**
 * The receipt log. Every tool call and every human action lands here newest-first; agent rows open
 * to show the exact input and result JSON, and a mutating agent action offers Undo for 8 seconds.
 */
import { useEffect, useMemo, useState } from "react";
import { useHearthStore } from "../state/store";
import type { ActivityEntry } from "../state/types";
import { compactJson, relativeTime, sourceLabel, splitNumerals } from "./format";
import { IconChevronDown, IconChevronRight, IconChevronUp, IconUndo, SourceIcon } from "./icons";
import { Button, EmptyState, IconButton, Panel } from "./primitives";
import { undoSteps } from "./useHearth";

const VISIBLE_ROWS = 60;
const UNDO_WINDOW_MS = 8_000;

const SOURCE_TINT = {
  human: "text-dusty-blue",
  agent: "text-terracotta",
  assistant: "text-plum",
  system: "text-ink-faint",
} as const;

/** Renders a receipt sentence with its measurements in Fraunces tabular numerals. */
function Sentence({ text }: { text: string }) {
  return (
    <>
      {splitNumerals(text).map((run, index) => (
        <span key={`${index}-${run.text}`} className={run.numeric ? "numerals" : undefined}>
          {run.text}
        </span>
      ))}
    </>
  );
}

function Row({ entry, now }: { entry: ActivityEntry; now: number }) {
  const [open, setOpen] = useState(false);
  const expandable = entry.tool !== undefined && (entry.input !== undefined || entry.result !== undefined);
  const failed = typeof entry.result === "object" && entry.result !== null && (entry.result as { ok?: boolean }).ok === false;

  const head = (
    <>
      <SourceIcon source={entry.source} size={15} className={`mt-0.5 shrink-0 ${SOURCE_TINT[entry.source]}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[12.5px] leading-snug ${failed ? "text-ink-muted" : "text-ink"}`}>
          <Sentence text={entry.summary} />
        </span>
        <span className="label-caps truncate text-[10px]">
          {sourceLabel(entry.source)}
          {entry.tool ? ` · ${entry.tool}` : ""} · {relativeTime(entry.t, now)}
        </span>
      </span>
    </>
  );

  return (
    // The receipt id is on the row so the assistant's tool chips can point straight at it.
    <li className="border-b border-hairline/70 last:border-0" data-receipt-id={entry.id}>
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-200 ease-out-soft hover:bg-charcoal/4"
        >
          {head}
          {open ? (
            <IconChevronDown size={14} className="mt-0.5 shrink-0 text-ink-faint" />
          ) : (
            <IconChevronRight size={14} className="mt-0.5 shrink-0 text-ink-faint" />
          )}
        </button>
      ) : (
        <div className="flex items-start gap-2.5 px-3.5 py-2.5">{head}</div>
      )}
      {open ? (
        <div className="flex flex-col gap-1.5 px-3.5 pb-3">
          <p className="label-caps text-[10px]">Input</p>
          <pre className="max-h-[110px] overflow-auto rounded-chip border border-hairline bg-plaster/70 p-2 font-mono text-[11px] leading-snug text-ink-muted panel-scroll">
            {compactJson(entry.input)}
          </pre>
          <p className="label-caps text-[10px]">Result</p>
          <pre className="max-h-[240px] overflow-auto rounded-chip border border-hairline bg-plaster/70 p-2 font-mono text-[11px] leading-snug text-ink-muted panel-scroll">
            {compactJson(entry.result)}
          </pre>
        </div>
      ) : null}
    </li>
  );
}

/** True for a tool receipt that reported success. */
function succeeded(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === true;
}

/**
 * The undo affordance for the newest agent change: offered for eight seconds, then it hands the
 * header back to the row count. Keyed by receipt id, so each new change restarts the window.
 */
function UndoChip({ count, onUndo }: { count: number; onUndo(): void }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, []);
  if (expired) return <span className="label-caps text-ink-faint">{count}</span>;
  return (
    <Button variant="secondary" size="sm" icon={IconUndo} onClick={onUndo}>
      Undo
    </Button>
  );
}

export function Activity({
  className = "",
  collapsed = false,
  onExpand,
  readOnlyTools,
}: {
  className?: string;
  /** The cart is expanded, so the log yields the space and shows its header only. */
  collapsed?: boolean;
  onExpand?(): void;
  /** Read-only tool names, so a receipt that changed nothing offers no undo. */
  readOnlyTools?: ReadonlySet<string>;
}) {
  const activity = useHearthStore((state) => state.activity);
  const [now, setNow] = useState(() => Date.now());

  // Every row in `activity[]` is a change to the design: selection, hover and room focus are not
  // written there at all any more (they live in `meta.selection`), so nothing is filtered by title.
  const rows = useMemo(() => activity.slice(0, VISIBLE_ROWS), [activity]);

  const newest = rows[0];
  const undoable = newest
    && (newest.source === "agent" || newest.source === "assistant")
    && newest.tool !== undefined
    && !(readOnlyTools?.has(newest.tool) ?? false)
    && succeeded(newest.result)
    ? newest
    : undefined;

  // Relative times stay honest without a per-row timer.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Panel
      label="Activity"
      className={className}
      actions={
        <>
          {undoable ? (
            <UndoChip key={undoable.id} count={rows.length} onUndo={() => undoSteps(1)} />
          ) : (
            <span className="label-caps text-ink-faint">{rows.length}</span>
          )}
          {collapsed && onExpand ? (
            <IconButton icon={IconChevronUp} label="Expand the activity log" size="sm" onClick={onExpand} />
          ) : null}
        </>
      }
      flush
      bodyClassName="overflow-y-auto panel-scroll"
    >
      {collapsed ? null : rows.length === 0 ? (
        <EmptyState
          title="Nothing has happened yet."
          hint="Every move you or your agent makes is written here, with the exact tool input and result."
        />
      ) : (
        <>
          <ul className="flex flex-col">
            {rows.map((entry) => (
              <Row key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
          {rows.length <= 2 ? (
            <p className="px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-muted">
              Every move lands here — yours and your agent&rsquo;s. Agent rows open to show the exact tool input and
              result, and a change your agent made can be undone for eight seconds.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
