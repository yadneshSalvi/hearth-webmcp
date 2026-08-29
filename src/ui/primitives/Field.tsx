"use client";
import type { ComponentType, InputHTMLAttributes } from "react";
import type { IconProps } from "../icons";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Accessible name; rendered as a small-caps label unless `hideLabel` is set. */
  label: string;
  hideLabel?: boolean;
  icon?: ComponentType<IconProps>;
  prefix?: string;
  numeric?: boolean;
}

/** Text, search and number input. One shape, one focus ring, one hairline. */
export function Field({
  label,
  hideLabel = false,
  icon: Icon,
  prefix,
  numeric = false,
  className = "",
  id,
  ...rest
}: FieldProps) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={fieldId} className={hideLabel ? "sr-only" : "label-caps"}>
        {label}
      </label>
      <div className="flex h-9 items-center gap-2 rounded-chip border border-hairline bg-plaster/70 px-2.5 transition-colors duration-200 ease-out-soft focus-within:border-ochre/60">
        {Icon ? <Icon size={15} className="shrink-0 text-ink-faint" /> : null}
        {prefix ? <span className="numerals shrink-0 text-[13px] text-ink-muted">{prefix}</span> : null}
        <input
          id={fieldId}
          className={`min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint ${
            numeric ? "numerals" : ""
          }`}
          {...rest}
        />
      </div>
    </div>
  );
}
