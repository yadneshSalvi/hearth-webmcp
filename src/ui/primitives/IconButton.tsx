"use client";
import type { ButtonHTMLAttributes, ComponentType } from "react";
import type { IconProps } from "../icons";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: ComponentType<IconProps>;
  /** Required: becomes both the accessible name and the hover tooltip. */
  label: string;
  size?: "sm" | "md";
  /** Pass only for toggles: it drives both the terracotta wash and `aria-pressed`. */
  active?: boolean;
  tone?: "default" | "primary";
  /** false inside a clipped container (a modal header) where a bubble would be cut off. */
  tooltip?: boolean;
}

/** A square icon control. Always named, always focus-ringed, tooltipped on hover. */
export function IconButton({
  icon: Icon,
  label,
  size = "md",
  active,
  tone = "default",
  tooltip = true,
  className = "",
  ...rest
}: IconButtonProps) {
  const box = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const skin = active
    ? "border-terracotta/40 bg-terracotta/12 text-terracotta"
    : tone === "primary"
      ? "border-hairline bg-terracotta text-plaster hover:bg-terracotta/88"
      : "border-hairline bg-plaster/60 text-ink-muted hover:bg-plaster hover:text-ink";
  const control = (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={`${box} inline-flex items-center justify-center rounded-chip border transition-colors duration-200 ease-out-soft disabled:cursor-not-allowed disabled:opacity-35 ${skin} ${className}`}
      {...rest}
    >
      <Icon size={size === "sm" ? 15 : 17} />
    </button>
  );
  return tooltip ? <Tooltip label={label}>{control}</Tooltip> : control;
}
