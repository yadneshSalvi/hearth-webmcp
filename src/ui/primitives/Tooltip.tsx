"use client";
import type { ReactNode } from "react";

export interface TooltipProps {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}

/**
 * Hover label. Presentational only — the control it wraps carries the accessible name, so the bubble
 * is `aria-hidden` and never doubles up for a screen reader. It does not appear on focus: keyboard
 * users get the ochre focus ring, and a bubble on autofocus would be noise.
 */
export function Tooltip({ label, side = "bottom", children }: TooltipProps) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-chip border border-hairline bg-plaster px-2 py-1 text-[11px] text-ink opacity-0 shadow-chip transition-opacity duration-200 ease-out-soft group-hover/tip:opacity-100 ${
          side === "bottom" ? "top-[calc(100%+7px)]" : "bottom-[calc(100%+7px)]"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
