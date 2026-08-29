"use client";
/**
 * The catalog panel. Search and filters call the same engine search the agent's `search_catalog`
 * tool calls, every row carries a live fit note for the active room, and a row can be dragged onto
 * the canvas or placed with a button.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { resolveAnchor } from "../engine/anchors";
import { fitNote, wallFits } from "../engine/fit";
import { walls } from "../engine/geometry";
import type { CatalogItem, Category, Room, Scene } from "../engine/types";
import { CATEGORIES } from "../engine/types";
import { hearthStore, useHearthStore } from "../state/store";
import { CatalogCard } from "./CatalogCard";
import { CatalogSkeleton } from "./CatalogSkeleton";
import { edgeFades, emptySuggestion, nextCardIndex } from "./catalogNav";
import type { CatalogSuggestion } from "./catalogNav";
import { catalogGroups, catalogResults, categoryLabel, styleTags } from "./catalogQuery";
import { cartOps, historyMarker, undoTo } from "./useHearth";
import { IconPanelLeft, IconSearch } from "./icons";
import { Chip, Field, IconButton, Panel } from "./primitives";
import { pushToast } from "./toast-bus";

type PriceCap = "any" | "500" | "1000";

const SEARCH_DEBOUNCE_MS = 160;

const PRICE_ORDER: readonly PriceCap[] = ["any", "500", "1000"];
const PRICE_LABELS: Record<PriceCap, string> = { any: "Any price", 500: "≤ $500", 1000: "≤ $1,000" };

/** The engine's own fit sentence for the wall (or room) that suits this product best. */
function fitFor(scene: Scene, room: Room, product: CatalogItem, catalog: CatalogItem[]): string {
  const fits = wallFits(scene, room, product, catalog);
  const best = fits.filter((entry) => entry.fits).sort((a, b) => a.spareCm - b.spareCm)[0]
    ?? [...fits].sort((a, b) => b.spareCm - a.spareCm)[0];
  const wall = best && walls(room).find((entry) => entry.id === best.wall);
  if (!wall) return `no wall free in ${room.name.toLowerCase()}`;
  return fitNote(scene, room, wall, product, catalog);
}

function place(product: CatalogItem, colorway: string): void {
  const state = hearthStore.getState();
  const roomId = state.scene.meta.activeRoomId;
  const room = state.scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return;
  const resolved = resolveAnchor(state.scene, roomId, product, { anchor: { centered: true } }, state.catalog);
  if (!resolved.ok) {
    pushToast({
      title: `${product.name} will not fit there yet`,
      detail: resolved.suggestion ?? resolved.detail,
      tone: "warn",
    });
    return;
  }
  const marker = historyMarker();
  const placed = state.placeItem("human", {
    catalogId: product.id,
    roomId,
    pos: resolved.pos,
    rotation: resolved.rotation,
    colorway,
  });
  hearthStore.getState().setSelection("human", { itemId: placed.id });
  pushToast({
    title: `${product.name} placed`,
    detail: resolved.note,
    tone: "success",
    action: { label: "Undo", run: () => undoTo(marker) },
  });
}

/**
 * A horizontally scrolling chip row. The plaster fade appears only on an edge that still has chips
 * past it, so the affordance means something: no fade, no more chips that way.
 */
function ScrollRow({ label, children }: { label: string; children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ start: false, end: false });

  const measure = (): void => {
    const node = track.current;
    if (!node) return;
    setFades((current) => {
      const next = edgeFades(node.scrollLeft, node.clientWidth, node.scrollWidth);
      return next.start === current.start && next.end === current.end ? current : next;
    });
  };

  // Chip rows change with the catalog and with the panel width, so both are watched.
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div className="relative">
      <div
        ref={track}
        onScroll={measure}
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 panel-scroll"
        role="group"
        aria-label={label}
      >
        {children}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -left-1 w-6 bg-gradient-to-r from-glass to-transparent transition-opacity duration-200 ease-out-soft"
        style={{ opacity: fades.start ? 1 : 0 }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -right-1 w-6 bg-gradient-to-l from-glass to-transparent transition-opacity duration-200 ease-out-soft"
        style={{ opacity: fades.end ? 1 : 0 }}
      />
    </div>
  );
}

/** Catalog rows visible at 900 px before anyone scrolls; their thumbnails load eagerly. */
const ABOVE_THE_FOLD = 5;

export function Catalog({ className = "", collapsible = false }: { className?: string; collapsible?: boolean }) {
  const catalog = useHearthStore((state) => state.catalog);
  const scene = useHearthStore((state) => state.scene);
  const cartLines = useHearthStore((state) => state.cart.lines);

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const [style, setStyle] = useState<string | undefined>(undefined);
  const [price, setPrice] = useState<PriceCap>("any");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);

  const room = scene.rooms.find((candidate) => candidate.id === scene.meta.activeRoomId) ?? scene.rooms[0];
  const shopMode = scene.meta.mode === "shop";

  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const results = useMemo(() => catalogResults(catalog, {
    query,
    ...(category ? { category } : {}),
    ...(style ? { style } : {}),
    ...(price === "any" ? {} : { maxPriceUsd: Number(price) }),
  }), [catalog, query, category, style, price]);

  const groups = useMemo(() => catalogGroups(results), [results]);

  const fitNotes = useMemo(
    () => new Map(room ? results.map((product) => [product.id, fitFor(scene, room, product, catalog)]) : []),
    [results, room, scene, catalog],
  );

  // Derived, not reset in an effect: a filtered-out card simply stops being the selected one.
  const selected = selectedId && results.some((product) => product.id === selectedId) ? selectedId : undefined;
  // The search is debounced, so for 160 ms the rows on screen answer the previous question.
  const settling = rawQuery.trim() !== query.trim();
  const suggestion = emptySuggestion({
    query,
    ...(category ? { category } : {}),
    ...(style ? { style } : {}),
    price,
  });

  const relax = (patch: CatalogSuggestion["patch"]): void => {
    if (patch.query !== undefined) {
      setRawQuery(patch.query);
      setQuery(patch.query);
    }
    if ("category" in patch) setCategory(undefined);
    if ("style" in patch) setStyle(undefined);
    if (patch.price) setPrice(patch.price);
  };

  /**
   * Up and down walk the cards; Enter places the focused one in the active room with whichever
   * colourway that card is showing, by pressing its own Place button.
   */
  const onCardKeys = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const node = list.current;
    if (!node) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const cards = [...node.querySelectorAll<HTMLElement>("[data-catalog-select]")];
      const current = cards.findIndex((card) => card === document.activeElement);
      const target = cards[nextCardIndex(cards.length, current, event.key === "ArrowDown" ? 1 : -1)];
      if (!target) return;
      event.preventDefault();
      target.focus();
      target.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key !== "Enter") return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active.dataset.catalogSelect === undefined) return;
    const place = active.closest("[data-catalog-card]")?.querySelector<HTMLElement>("[data-catalog-place]");
    if (!place) return;
    event.preventDefault();
    place.click();
  };

  if (!room) return null;

  const addToCart = (product: CatalogItem, colorway: string): void => {
    void cartOps.add({ product, colorway }).then((ok) => {
      if (ok) {
        hearthStore.getState().setUi({ cartOpen: true });
        pushToast({ title: `${product.name} added to the cart`, tone: "success" });
      }
    });
  };

  return (
    <Panel
      label="Catalog"
      actions={
        <>
          <span className="label-caps text-ink-faint">
            {results.length === catalog.length ? `${catalog.length} items` : `${results.length} of ${catalog.length}`}
          </span>
          {collapsible ? (
            <IconButton
              icon={IconPanelLeft}
              label="Collapse the catalog"
              size="sm"
              onClick={() => hearthStore.getState().setUi({ catalogCollapsed: true })}
            />
          ) : null}
        </>
      }
      className={className}
      flush
    >
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-hairline p-3.5">
        <Field
          label="Search the catalog"
          hideLabel
          icon={IconSearch}
          type="search"
          placeholder="Search sofas, oak, japandi…"
          value={rawQuery}
          onChange={(event) => setRawQuery(event.target.value)}
        />
        <ScrollRow label="Category filter">
          <Chip active={category === undefined} onClick={() => setCategory(undefined)}>All</Chip>
          {CATEGORIES.map((entry) => (
            <Chip key={entry} active={category === entry} onClick={() => setCategory(category === entry ? undefined : entry)}>
              {categoryLabel(entry)}
            </Chip>
          ))}
        </ScrollRow>
        <ScrollRow label="Style and price filters">
          <Chip
            active={price !== "any"}
            aria-label={`Maximum price: ${PRICE_LABELS[price]}. Click to change.`}
            onClick={() => setPrice(PRICE_ORDER[(PRICE_ORDER.indexOf(price) + 1) % PRICE_ORDER.length] as PriceCap)}
          >
            {PRICE_LABELS[price]}
          </Chip>
          {styleTags(catalog).map((tag) => (
            <Chip key={tag} active={style === tag} onClick={() => setStyle(style === tag ? undefined : tag)}>
              {tag}
            </Chip>
          ))}
        </ScrollRow>
      </div>

      <div
        ref={list}
        role="group"
        aria-label="Catalog results"
        aria-keyshortcuts="ArrowUp ArrowDown Enter"
        onKeyDown={onCardKeys}
        className="min-h-0 flex-1 overflow-y-auto p-3 panel-scroll"
      >
        {settling ? (
          <CatalogSkeleton />
        ) : results.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
            <p className="font-display text-[15px] leading-snug italic text-ink-muted">Nothing matches that yet.</p>
            <p className="max-w-[28ch] text-[12px] leading-relaxed text-ink-muted">
              Relax one filter, or ask your agent to search the catalog for you.
            </p>
            <Chip icon={IconSearch} data-catalog-suggestion onClick={() => relax(suggestion.patch)}>
              {suggestion.label}
            </Chip>
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <section key={group.category} className="mb-4 last:mb-0">
              <h3 className="label-caps mb-2 px-0.5">{categoryLabel(group.category)}</h3>
              <ul className="flex flex-col gap-2">
                {group.items.map((product, itemIndex) => (
                  <CatalogCard
                    key={product.id}
                    // The first rows are on screen before anyone scrolls, and the first of them is
                    // the page's LCP element, so those thumbnails are not lazy (src/ui/CatalogThumb.tsx).
                    priority={groupIndex === 0 && itemIndex < ABOVE_THE_FOLD}
                    product={product}
                    fit={fitNotes.get(product.id) ?? ""}
                    roomName={room.name}
                    shopMode={shopMode}
                    inCart={cartLines.some((line) => line.handle === product.id)}
                    selected={selected === product.id}
                    onSelect={() => setSelectedId(selected === product.id ? undefined : product.id)}
                    onPlace={place}
                    onAddToCart={addToCart}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Panel>
  );
}
