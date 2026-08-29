"use client";
import type { ComponentType, KeyboardEvent } from "react";
import type { IconProps } from "../icons";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<IconProps>;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange(value: T): void;
  size?: "sm" | "md";
  iconOnly?: boolean;
  className?: string;
}

/** Segmented control on a recessed track: mode, view and time all use it. Arrow keys move. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
  iconOnly = false,
  className = "",
}: SegmentedProps<T>) {
  const height = size === "sm" ? "h-7" : "h-9";
  const pad = iconOnly ? (size === "sm" ? "w-7" : "w-9") : size === "sm" ? "px-2.5" : "px-3";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`inline-flex ${height} items-center gap-0.5 rounded-pill border border-hairline bg-charcoal/5 p-0.5 ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconOnly ? option.label : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`inline-flex h-full items-center justify-center gap-1.5 rounded-pill text-[12px] transition-colors duration-200 ease-out-soft ${pad} ${
              selected ? "bg-plaster text-ink shadow-chip" : "text-ink-muted hover:text-ink"
            }`}
          >
            {Icon ? <Icon size={size === "sm" ? 14 : 16} /> : null}
            {iconOnly ? null : option.label}
          </button>
        );
      })}
    </div>
  );
}
