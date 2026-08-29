import type { ReactNode } from "react";

/** A keycap. Inter, tabular, hairline border — used in tooltips and the shortcuts sheet. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-chip border border-hairline bg-plaster/80 px-1 font-sans text-[10px] leading-none text-ink-muted">
      {children}
    </kbd>
  );
}
