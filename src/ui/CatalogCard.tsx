"use client";
/**
 * One catalog row: tile, name, price, footprint, colorways and a live fit note for the active room.
 * Drag it onto the canvas (`application/x-hearth-catalog`) or use the keyboard-reachable buttons.
 */
import { useRef, useState } from "react";
import type { DragEvent } from "react";
import type { CatalogItem } from "../engine/types";
import { ink, palette, shadow } from "../tokens";
import { CatalogThumb } from "./CatalogThumb";
import { colorwayHex, colorwayLabel, dimsLine, usd } from "./format";
import { IconCart, IconCheck, IconPlus } from "./icons";
import { Button, Tag } from "./primitives";

export const CATALOG_DRAG_TYPE = "application/x-hearth-catalog";

export interface CatalogCardProps {
  product: CatalogItem;
  /** Fit note for the active room, e.g. "fits north wall · 40 cm spare". */
  fit: string;
  roomName: string;
  shopMode: boolean;
  inCart: boolean;
  selected: boolean;
  onSelect(): void;
  onPlace(product: CatalogItem, colorway: string): void;
  onAddToCart(product: CatalogItem, colorway: string): void;
  /** true for the rows that are on screen before anyone scrolls; their thumbnails load eagerly. */
  priority?: boolean;
}

function dragImage(product: CatalogItem, colorway: string): HTMLElement {
  const node = document.createElement("div");
  node.style.cssText = [
    "position:fixed", "top:-1200px", "left:-1200px", "display:flex", "align-items:center", "gap:8px",
    "padding:8px 12px", "border-radius:10px", `border:1px solid ${ink.hairline}`, `background:${palette.plaster}`,
    `box-shadow:${shadow.chip}`, "font:500 12px Inter, system-ui, sans-serif", `color:${palette.charcoal}`,
    "white-space:nowrap", "pointer-events:none",
  ].join(";");
  const dot = document.createElement("span");
  dot.style.cssText = `width:10px;height:10px;border-radius:999px;background:${colorwayHex(colorway)};border:1px solid ${ink.hairline}`;
  node.appendChild(dot);
  node.appendChild(document.createTextNode(`${product.name} · ${dimsLine(product.dims)}`));
  return node;
}

export function CatalogCard({
  product, fit, roomName, shopMode, inCart, selected, onSelect, onPlace, onAddToCart, priority = false,
}: CatalogCardProps) {
  const [colorway, setColorway] = useState(product.colorways[0]?.id ?? "oak");
  const ghost = useRef<HTMLElement | undefined>(undefined);
  const fits = fit.startsWith("fits");

  const onDragStart = (event: DragEvent<HTMLLIElement>): void => {
    event.dataTransfer.setData(CATALOG_DRAG_TYPE, JSON.stringify({ catalogId: product.id, colorway }));
    event.dataTransfer.effectAllowed = "copy";
    const node = dragImage(product, colorway);
    document.body.appendChild(node);
    event.dataTransfer.setDragImage(node, 20, 20);
    ghost.current = node;
  };

  const onDragEnd = (): void => {
    ghost.current?.remove();
    ghost.current = undefined;
  };

  return (
    <li
      draggable
      data-catalog-card
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group flex flex-col gap-2 rounded-panel border p-2.5 transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out-soft hover:-translate-y-px hover:shadow-chip ${
        selected ? "border-terracotta/40 bg-terracotta/8" : "border-hairline bg-plaster/45 hover:border-charcoal/20"
      }`}
    >
      <button
        type="button"
        data-catalog-select
        onClick={onSelect}
        aria-pressed={selected}
        className="flex items-start gap-3 text-left"
      >
        {/* No colourway strip under the tile: the thumbnail is rendered in this colourway through
            the studio's own materials, and the swatch row below already names it. */}
        <CatalogThumb productId={product.id} category={product.category} colorway={colorway} name={product.name} width={84} decorative priority={priority} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{product.name}</span>
            <span className={`numerals shrink-0 ${shopMode ? "text-[15px] text-ink" : "text-[13px] text-ink-muted"}`}>
              {usd(product.price ?? 0)}
            </span>
          </span>
          <span className="numerals text-[11.5px] text-ink-muted">{dimsLine(product.dims)}</span>
          <span className="truncate text-[11px] text-ink-faint">{product.styleTags.join(" · ")}</span>
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {/* The mark stays 14 px; the button around it is 24 px, the smallest target WCAG 2.2 accepts
            (Lighthouse `target-size`). The negative margin keeps the row's rhythm unchanged. */}
        <div className="-mx-1.5 flex items-center" role="group" aria-label={`Colourways for ${product.name}`}>
          {product.colorways.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-label={colorwayLabel(option.id)}
              aria-pressed={option.id === colorway}
              onClick={() => setColorway(option.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill"
            >
              <span
                aria-hidden="true"
                style={{ background: option.hex }}
                className={`block h-3.5 w-3.5 rounded-pill border transition-[box-shadow] duration-200 ease-out-soft ${
                  option.id === colorway ? "border-charcoal/35 ring-2 ring-ochre/60" : "border-charcoal/20"
                }`}
              />
            </button>
          ))}
        </div>
        {shopMode && inCart ? <Tag tone="sage" icon={IconCheck}>In cart</Tag> : null}
        {/* The row wraps rather than truncates: a fit note is a measurement, and "by 14 c" is a lie. */}
        <Tag tone={fits ? "sage" : "amber"} className="ml-auto">{fit}</Tag>
      </div>

      <div className={`flex items-center gap-2 ${selected ? "" : "hidden group-hover:flex group-focus-within:flex"}`}>
        <Button
          variant="primary"
          size="sm"
          icon={IconPlus}
          data-catalog-place
          onClick={() => onPlace(product, colorway)}
          className="flex-1"
        >
          Place in {roomName}
        </Button>
        {shopMode ? (
          <Button
            variant="secondary"
            size="sm"
            icon={inCart ? IconCheck : IconCart}
            onClick={() => onAddToCart(product, colorway)}
          >
            {/* The badge above already says it is in the cart; the button offers the next quantity. */}
            {inCart ? "Add again" : "Add"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
