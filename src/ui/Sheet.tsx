"use client";
/**
 * The studio's one modal shell: warm scrim, centred glass card, focus trap, Escape to close and
 * focus restored to whatever opened it.
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { IconClose } from "./icons";
import { IconButton } from "./primitives";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** false hides the close affordance (the scrim and Escape still call onClose). */
  showClose?: boolean;
  /** Extra class on the card, e.g. to pin it to the top of the viewport. */
  className?: string;
}

export function Sheet({
  open, onClose, title, subtitle, children, footer, width = 460, showClose = true, className = "",
}: SheetProps) {
  const card = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const titleId = `sheet-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = card.current;
    const initial = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      restore.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fade-in pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-6">
      <button
        type="button"
        aria-label={`Dismiss ${title}`}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-charcoal/34 backdrop-blur-[3px]"
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width }}
        className={`glass-solid rise-in relative flex max-h-[84vh] max-w-[92vw] flex-col overflow-hidden ${className}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-[20px] leading-tight text-ink">{title}</h2>
            {subtitle ? <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted">{subtitle}</p> : null}
          </div>
          {showClose ? <IconButton icon={IconClose} label={`Close ${title}`} size="sm" tooltip={false} onClick={onClose} /> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 panel-scroll">{children}</div>
        {footer ? <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-5 py-3.5">{footer}</footer> : null}
      </div>
    </div>
  );
}
