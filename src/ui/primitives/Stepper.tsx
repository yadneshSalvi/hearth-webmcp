"use client";
import type { KeyboardEvent } from "react";
import { IconMinus, IconPlus } from "../icons";
import { IconButton } from "./IconButton";

export interface StepperProps {
  /** Accessible name, e.g. "Width". Rendered as a small-caps label unless hidden. */
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  /** Unit shown after the value, e.g. "cm". */
  unit?: string;
  hideLabel?: boolean;
  className?: string;
  onChange(value: number): void;
}

/**
 * A centimetre stepper: two buttons and a `spinbutton` value that also takes the arrow keys, so a
 * dimension can be nudged with the pointer or the keyboard alone.
 */
export function Stepper({
  label, value, step = 10, min = 0, max = Number.MAX_SAFE_INTEGER, unit = "cm", hideLabel = false, className = "", onChange,
}: StepperProps) {
  const clamp = (next: number): number => Math.max(min, Math.min(max, Math.round(next)));
  const nudge = (delta: number): void => {
    const next = clamp(value + delta);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    const delta = event.key === "ArrowUp" || event.key === "ArrowRight" ? step
      : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -step
        : event.key === "PageUp" ? step * 5
          : event.key === "PageDown" ? -step * 5
            : 0;
    if (delta === 0) return;
    event.preventDefault();
    nudge(delta);
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {hideLabel ? null : <span className="label-caps">{label}</span>}
      <div className="flex items-center gap-1">
        <IconButton
          icon={IconMinus}
          label={`Decrease ${label.toLowerCase()} by ${step} ${unit || "cm"}`}
          size="sm"
          tooltip={false}
          disabled={value <= min}
          onClick={() => nudge(-step)}
        />
        <span
          role="spinbutton"
          tabIndex={0}
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuetext={`${value} ${unit || "cm"}`}
          {...(max === Number.MAX_SAFE_INTEGER ? {} : { "aria-valuemax": max })}
          onKeyDown={onKeyDown}
          className="numerals flex h-7 min-w-0 flex-1 items-center justify-center rounded-chip border border-hairline bg-plaster/70 px-1 text-[12.5px] text-ink"
        >
          {unit ? `${value} ${unit}` : value}
        </span>
        <IconButton
          icon={IconPlus}
          label={`Increase ${label.toLowerCase()} by ${step} ${unit || "cm"}`}
          size="sm"
          tooltip={false}
          disabled={value >= max}
          onClick={() => nudge(step)}
        />
      </div>
    </div>
  );
}
