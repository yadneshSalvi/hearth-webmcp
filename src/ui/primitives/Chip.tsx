"use client";
import type { ButtonHTMLAttributes, ComponentType, HTMLAttributes, ReactNode } from "react";
import type { IconProps } from "../icons";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ComponentType<IconProps>;
  tone?: "neutral" | "sage" | "amber" | "terracotta";
  children: ReactNode;
}

const TONES = {
  neutral: "border-hairline bg-plaster/55 text-ink-muted hover:bg-plaster hover:text-ink",
  sage: "border-sage/35 bg-sage/12 text-ink",
  amber: "border-amber/40 bg-amber/12 text-ink",
  terracotta: "border-terracotta/40 bg-terracotta/12 text-ink",
} as const;

/** A pill: filter, toggle or read-only tag. Active state is a terracotta wash, never a fill. */
export function Chip({ active = false, icon: Icon, tone = "neutral", className = "", children, ...rest }: ChipProps) {
  const skin = active ? TONES.terracotta : TONES[tone];
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill border px-2.5 text-[12px] transition-colors duration-200 ease-out-soft disabled:cursor-not-allowed disabled:opacity-40 ${skin} ${className}`}
      {...rest}
    >
      {Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}

/** The non-interactive twin of Chip, for badges such as a fit note or "in cart". */
export function Tag({
  tone = "neutral",
  icon: Icon,
  className = "",
  children,
  ...rest
}: {
  tone?: ChipProps["tone"];
  icon?: ComponentType<IconProps>;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={`inline-flex h-6 max-w-full items-center gap-1 rounded-pill border px-2 text-[11px] ${TONES[tone ?? "neutral"]} ${className}`}
      {...rest}
    >
      {Icon ? <Icon size={12} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
