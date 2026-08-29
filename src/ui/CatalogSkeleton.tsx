"use client";
/**
 * Catalog skeleton rows — the shape of the answer while the search settles, in plaster, breathing
 * (STYLE.md §4: empty and loading states are designed, never a spinner).
 */
export function CatalogSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <span className="label-caps breathe block h-3 w-16 rounded-pill bg-charcoal/10" />
      {Array.from({ length: rows }, (_unused, index) => (
        <div
          key={index}
          className="breathe flex items-start gap-3 rounded-panel border border-hairline bg-plaster/45 p-2.5"
          style={{ animationDelay: `${index * 110}ms` }}
        >
          <span className="block h-[63px] w-[84px] shrink-0 rounded-chip bg-charcoal/8" />
          <span className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <span className="flex items-center gap-2">
              <span className="block h-2.5 flex-1 rounded-pill bg-charcoal/10" />
              <span className="block h-2.5 w-10 rounded-pill bg-charcoal/8" />
            </span>
            <span className="block h-2 w-24 rounded-pill bg-charcoal/8" />
            <span className="block h-2 w-16 rounded-pill bg-charcoal/6" />
          </span>
        </div>
      ))}
    </div>
  );
}
