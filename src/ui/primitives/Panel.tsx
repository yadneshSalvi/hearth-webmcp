"use client";
import type { ReactNode } from "react";

/** An alpha mask, not a colour: `black` is fully opaque, `transparent` fully clear. */
const FADE = "linear-gradient(to bottom, black calc(100% - 16px), transparent 100%)";

export interface PanelProps {
  /** Small-caps section label, e.g. "CATALOG". */
  label?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Pinned below the scrolling body — primary actions never scroll out of reach. */
  footer?: ReactNode;
  /** Renders the body without padding (lists supply their own). */
  flush?: boolean;
  /** Fades the last 16 px of a scrolling body, so clipped content never ends mid-word. */
  fade?: boolean;
}

/**
 * A floating glass card: 16 px radius, 1 px hairline, warm shadow, small-caps header.
 * `data-studio-inset` tells the camera rig this box covers part of the canvas (src/scene/insets.ts).
 */
export function Panel({ label, actions, children, className = "", bodyClassName = "", footer, flush = false, fade = false }: PanelProps) {
  return (
    <section data-studio-inset="" className={`glass rise-in pointer-events-auto flex min-h-0 flex-col overflow-hidden ${className}`}>
      {label || actions ? (
        <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-hairline px-4">
          {label ? <h2 className="label-caps truncate">{label}</h2> : <span />}
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      ) : null}
      <div
        className={`flex min-h-0 flex-1 flex-col ${flush ? "" : "p-4"} ${bodyClassName}`}
        style={fade ? { maskImage: FADE, WebkitMaskImage: FADE } : undefined}
      >
        {children}
      </div>
      {footer ? <div className="shrink-0 border-t border-hairline px-4 py-2.5">{footer}</div> : null}
    </section>
  );
}

/** Designed empty state: Fraunces italic, one line of guidance, never a shrug. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
      <p className="font-display text-[15px] italic text-ink-muted">{title}</p>
      {hint ? <p className="max-w-[26ch] text-[12px] leading-relaxed text-ink-muted">{hint}</p> : null}
    </div>
  );
}
