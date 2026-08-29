"use client";
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import type { IconProps } from "../icons";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ComponentType<IconProps>;
  block?: boolean;
  children?: ReactNode;
}

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-chip font-sans font-medium whitespace-nowrap " +
  "transition-[background-color,color,border-color,box-shadow] duration-200 ease-out-soft " +
  "disabled:cursor-not-allowed disabled:opacity-40";

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px]",
  md: "h-9 px-3.5 text-[13px]",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-terracotta text-plaster shadow-chip hover:bg-terracotta/88 active:bg-terracotta",
  secondary: "border border-hairline bg-plaster/70 text-ink hover:border-charcoal/24 hover:bg-plaster",
  ghost: "text-ink-muted hover:bg-charcoal/6 hover:text-ink",
};

/** The only button in the studio. Primary is terracotta, secondary is a hairline plaster card. */
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  block = false,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${block ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {Icon ? <Icon size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </button>
  );
}
