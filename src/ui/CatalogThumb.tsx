"use client";
/**
 * Catalog thumbnails. The rendered PNG in `/assets/thumbs` is preferred; when one is missing the
 * card falls back to a *designed* tile — a category silhouette in the item's colorway on plaster,
 * drawn here so a missing asset never looks like a broken image.
 */
import { useState } from "react";
import type { Category } from "../engine/types";
import { mix, palette } from "../tokens";
import { colorwayHex } from "./format";

const SILHOUETTES: Record<Category, string[]> = {
  sofa: ["M26 40h76v10H26z", "M18 48h92v18a5 5 0 0 1-5 5H23a5 5 0 0 1-5-5z", "M28 71h5v6h-5z", "M95 71h5v6h-5z"],
  armchair: ["M40 38h48v12H40z", "M34 48h60v18a5 5 0 0 1-5 5H39a5 5 0 0 1-5-5z", "M40 71h5v6h-5z", "M83 71h5v6h-5z"],
  bed: ["M18 32h18v34H18z", "M18 48h92v18a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4z", "M24 70h5v7h-5z", "M99 70h5v7h-5z"],
  wardrobe: ["M40 18h48v58H40z", "M63 18h2v58h-2z"],
  table: ["M16 44h96v7H16z", "M26 51h5v26h-5z", "M97 51h5v26h-5z"],
  desk: ["M18 42h92v7H18z", "M22 49h6v28h-6z", "M84 49h22v28H84z"],
  chair: ["M46 26h34v26H46z", "M40 52h46v7H40z", "M44 59h5v18h-5z", "M77 59h5v18h-5z"],
  shelf: ["M32 20h64v56H32z", "M32 38h64v3H32z", "M32 55h64v3H32z"],
  "tv-unit": ["M18 52h92v22H18z", "M63 52h2v22h-2z"],
  rug: ["M20 54h88a9 9 0 0 1 0 18H20a9 9 0 0 1 0-18z"],
  "floor-lamp": ["M50 22h28l6 16H44z", "M62 38h4v34h-4z", "M52 72h24v5H52z"],
  "table-lamp": ["M54 36h20l5 12H49z", "M62 48h4v20h-4z", "M53 68h22v5H53z"],
  plant: ["M52 56h24l-4 21H56z", "M64 56c0-14-9-22-19-24 2 13 8 21 19 24z", "M64 56c0-16 8-24 18-26-1 14-7 22-18 26z"],
  decor: ["M56 24h16v8l7 14a16 16 0 0 1-30 0l7-14z"],
};

export interface CatalogThumbProps {
  productId: string;
  category: Category;
  colorway: string;
  name: string;
  className?: string;
  /** Rendered size in CSS pixels; the tile is always 4:3. */
  width?: number;
  /** true inside a control that already names the product, so the tile is not announced twice. */
  decorative?: boolean;
  /**
   * true for the handful of tiles that are above the fold on first paint. The catalog is inside a
   * client-only shell, so its first thumbnail is the page's Largest Contentful Paint: leaving it
   * lazy makes the browser wait for layout before it even asks for the file.
   */
  priority?: boolean;
}

/** A 4:3 product tile: rendered asset when present, drawn silhouette when not. */
export function CatalogThumb({ productId, category, colorway, name, className = "", width = 88, decorative = false, priority = false }: CatalogThumbProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const height = Math.round((width * 3) / 4);
  // A 12 % wash of the item's own colourway, for the *drawn* fallback only: with no render to sit
  // on, the silhouette reads as a designed swatch rather than a blank square.
  const tile = mix(palette.plaster, colorwayHex(colorway), 0.12);

  if (failed) {
    return (
      <span
        className={`block overflow-hidden rounded-chip ${className}`}
        style={{ width, height, background: tile }}
        {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      >
        <svg viewBox="0 0 128 96" width={width} height={height} aria-hidden="true">
          <rect width="128" height="96" fill={tile} />
          <ellipse cx="64" cy="80" rx="42" ry="5" fill={palette.charcoal} opacity="0.1" />
          <g fill={colorwayHex(colorway)}>
            {SILHOUETTES[category].map((path) => (
              <path key={path} d={path} />
            ))}
          </g>
        </svg>
      </span>
    );
  }

  return (
    // The tile is the render's own backdrop (`THUMB_BACKDROP` = canvas.bottom): the warm end of the
    // studio gradient, a whisper darker than the plaster card, which is what stops a pale rug from
    // vanishing. The PNG and the tile are the same colour, so there is still no ring around the art.
    <span
      className={`relative block shrink-0 overflow-hidden rounded-chip bg-canvas-bottom ${className}`}
      style={{ width, height }}
    >
      {/* A still tint, not a shimmer: `loading="lazy"` leaves most of a 71-row list unloaded, and
          sixty-odd looping animations would keep the compositor busy for nothing. */}
      {loaded ? null : <span className="absolute inset-0 bg-charcoal/8" aria-hidden="true" />}
      {/* A fixed-size local PNG: next/image would add no optimisation (these are pre-rendered at
          512×384) and its dev-only LCP heuristic warns about lazy thumbnails in a scrolling list. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/assets/thumbs/${productId}.png`}
        alt={decorative ? "" : name}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className="block h-full w-full object-cover transition-opacity duration-200 ease-out-soft"
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </span>
  );
}
