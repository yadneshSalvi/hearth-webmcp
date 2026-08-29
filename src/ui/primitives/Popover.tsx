"use client";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  /** Accessible name of the floating group. */
  label: string;
  align?: "left" | "right";
  width?: number;
  children: ReactNode;
}

/**
 * A floating glass card anchored under its trigger. Escape closes, a pointer press outside closes,
 * and the first focusable child receives focus on open.
 */
export function Popover({ open, onClose, label, align = "left", width = 240, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    node?.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && (node?.contains(target) || node?.parentElement?.contains(target))) return;
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      style={{ width }}
      className={`glass rise-in absolute top-[calc(100%+8px)] z-50 max-h-[60vh] overflow-y-auto p-1.5 panel-scroll ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </div>
  );
}
