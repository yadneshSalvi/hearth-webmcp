"use client";
/** Structured toasts: title, optional detail with units, at most one action. Auto-dismiss in 5 s. */
import { IconClose } from "./icons";
import { splitNumerals } from "./format";
import { Button, IconButton } from "./primitives";
import { dismissToast, useToasts } from "./toast-bus";

const TONES = {
  info: "border-hairline",
  success: "border-sage/40",
  warn: "border-amber/45",
} as const;

export function Toasts({ className = "" }: { className?: string }) {
  const toasts = useToasts();

  // The live region is always in the tree: a screen reader only announces changes inside a region
  // it was already watching, so creating it together with the first toast would swallow that toast.
  return (
    <div
      aria-live="polite"
      aria-label="Studio notifications"
      className={`pointer-events-none flex flex-col gap-2 ${className}`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`glass rise-in pointer-events-auto flex w-[318px] items-start gap-2.5 border p-3 ${TONES[toast.tone]}`}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-[12.5px] font-medium leading-snug text-ink">
              {splitNumerals(toast.title).map((run, index) => (
                <span key={`${index}-${run.text}`} className={run.numeric ? "numerals" : undefined}>{run.text}</span>
              ))}
            </p>
            {toast.detail ? (
              <p className="text-[11.5px] leading-snug text-ink-muted">
                {splitNumerals(toast.detail).map((run, index) => (
                  <span key={`${index}-${run.text}`} className={run.numeric ? "numerals" : undefined}>{run.text}</span>
                ))}
              </p>
            ) : null}
            {toast.action ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-0.5 self-start px-0"
                onClick={() => {
                  toast.action?.run();
                  dismissToast(toast.id);
                }}
              >
                {toast.action.label}
              </Button>
            ) : null}
          </div>
          <IconButton icon={IconClose} label="Dismiss notification" size="sm" onClick={() => dismissToast(toast.id)} />
        </div>
      ))}
    </div>
  );
}
