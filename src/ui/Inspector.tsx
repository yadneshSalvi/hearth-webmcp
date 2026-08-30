"use client";
/**
 * Inspector: the selected item, or — when nothing is selected — the room itself, scored by the
 * design engine, or the whole home while the camera is framing it. Every state is designed; none is
 * ever blank.
 */
import { useMemo } from "react";
import { resolveAnchor, rotateBy } from "../engine/anchors";
import { createCatalog } from "../engine/catalog";
import { conflictsForItem, evaluateRoom } from "../engine/conflicts";
import { wallsLine } from "../engine/describe";
import { roomAreaM2 } from "../engine/geometry";
import { designReport } from "../engine/report";
import type { DesignScores } from "../engine/report";
import type { CatalogItem, Furniture, Room, Scene } from "../engine/types";
import { useHomeFocus } from "../scene/focus";
import { hearthStore, useHearthStore } from "../state/store";
import { cartOps, historyMarker, undoTo, useConflicts } from "./useHearth";
import { CatalogThumb } from "./CatalogThumb";
import { ConflictRow } from "./ConflictRow";
import { categoryLabel } from "./catalogQuery";
import { colorwayLabel, dimsFull, plural, usd } from "./format";
import { IconCart, IconCheck, IconCompare, IconHome, IconLock, IconPanelRight, IconRotateRight, IconTrash, IconUnlock } from "./icons";
import { Button, EmptyState, IconButton, Panel, Tag } from "./primitives";
import { pushToast } from "./toast-bus";

const SCORE_LABELS: Record<keyof DesignScores, string> = {
  balance: "Balance",
  focal_point: "Focal point",
  conversation: "Conversation",
  lighting: "Lighting",
  storage: "Storage",
  traffic: "Traffic",
};

function rotate(item: Furniture, product: CatalogItem): void {
  const state = hearthStore.getState();
  const rotation = rotateBy(item, 90);
  const resolved = resolveAnchor(
    state.scene,
    item.roomId,
    product,
    { pos: item.pos, rotation, ignoreItemIds: [item.id] },
    state.catalog,
  );
  if (!resolved.ok) {
    pushToast({ title: `${product.name} cannot turn here`, detail: resolved.suggestion ?? resolved.detail, tone: "warn" });
    return;
  }
  const marker = historyMarker();
  state.moveItem("human", item.id, { pos: resolved.pos, rotation: resolved.rotation });
  pushToast({
    title: `${product.name} turned 90°`,
    ...(resolved.nudgedCm > 0 ? { detail: `nudged ${resolved.nudgedCm} cm to stay clear` } : {}),
    action: { label: "Undo", run: () => undoTo(marker) },
  });
}

function remove(item: Furniture, product: CatalogItem): void {
  const marker = historyMarker();
  hearthStore.getState().removeItem("human", item.id);
  pushToast({
    title: `${product.name} removed`,
    tone: "info",
    action: { label: "Undo", run: () => undoTo(marker) },
  });
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-[86px] shrink-0 text-[11.5px] text-ink-muted">{label}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-pill bg-charcoal/10">
        <span
          className="block h-full rounded-pill bg-sage transition-[width] duration-300 ease-out-soft"
          style={{ width: `${Math.max(4, Math.min(100, value * 10))}%` }}
        />
      </span>
      <span className="numerals w-5 shrink-0 text-right text-[11.5px] text-ink-muted">{value}</span>
    </li>
  );
}

/** One measured row of the home summary: a small-caps label and a Fraunces figure. */
function HomeStat({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "muted" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline/70 py-1.5 last:border-0">
      <span className="label-caps">{label}</span>
      <span className={`numerals text-[13px] ${tone === "muted" ? "text-ink-muted" : "text-ink"}`}>{value}</span>
    </div>
  );
}

/**
 * The whole home, while the camera is framing it (src/scene/homeFocus.ts — which is where a template
 * apply lands). The panel and the camera must agree about the subject: naming the active room under
 * a shot of eleven rooms is the panel disagreeing with what the human can see.
 */
function HomeCard({ scene, catalogItems }: { scene: Scene; catalogItems: CatalogItem[] }) {
  const summary = useMemo(() => {
    const catalog = createCatalog(catalogItems);
    const placed = scene.furniture.filter((item) => item.status === "placed");
    let conflicts = 0;
    let errors = 0;
    for (const room of scene.rooms) {
      for (const conflict of evaluateRoom(scene, room.id, catalog)) {
        conflicts += 1;
        if (conflict.severity === "error") errors += 1;
      }
    }
    return {
      rooms: scene.rooms.length,
      bedrooms: scene.rooms.filter((room) => room.type === "bedroom").length,
      baths: scene.rooms.filter((room) => room.type === "bath").length,
      areaM2: scene.rooms.reduce((total, room) => total + roomAreaM2(room), 0),
      items: placed.length,
      spentUsd: placed.reduce((total, item) => total + (catalog.byId(item.catalogId)?.price ?? 0), 0),
      conflicts,
      errors,
    };
  }, [scene, catalogItems]);
  const budgetUsd = scene.meta.budgetUsd;
  const remaining = budgetUsd === undefined ? undefined : budgetUsd - summary.spentUsd;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display flex items-center gap-2 truncate text-[19px] leading-tight text-ink">
            <IconHome size={16} className="shrink-0 text-terracotta" />
            Entire home
          </h3>
          <p className="label-caps mt-1.5">
            {plural(summary.rooms, "room")} · {plural(summary.items, "item")}
          </p>
        </div>
        <div className="text-right">
          <p className="numerals text-[26px] leading-none text-ink">{summary.areaM2.toFixed(1)}</p>
          <p className="label-caps mt-1 text-ink-faint">m²</p>
        </div>
      </div>

      <dl className="flex flex-col">
        <HomeStat label="Bedrooms" value={`${summary.bedrooms}`} />
        <HomeStat label="Bathrooms" value={`${summary.baths}`} />
        <HomeStat label="Furniture" value={usd(summary.spentUsd)} />
        <HomeStat
          label={budgetUsd === undefined ? "Budget" : "Remaining"}
          value={remaining === undefined ? "not set" : usd(remaining)}
          tone={remaining !== undefined && remaining < 0 ? "ink" : "muted"}
        />
        <HomeStat
          label="Conflicts"
          value={summary.conflicts === 0 ? "none" : `${summary.conflicts}${summary.errors > 0 ? ` · ${summary.errors} to fix` : ""}`}
          tone={summary.conflicts === 0 ? "muted" : "ink"}
        />
      </dl>

      <p className="text-[12.5px] leading-relaxed text-ink-muted">
        Pick a room from the switcher, or click one on the canvas, to zoom in and score it.
      </p>
    </div>
  );
}

function RoomCard({ room }: { room: Room }) {
  const scene = useHearthStore((state) => state.scene);
  const catalogItems = useHearthStore((state) => state.catalog);
  const conflicts = useConflicts();
  const report = useMemo(
    () => designReport(scene, room.id, createCatalog(catalogItems), conflicts),
    [scene, room.id, catalogItems, conflicts],
  );
  const items = scene.furniture.filter((item) => item.roomId === room.id && item.status === "placed").length;
  const keys = Object.keys(SCORE_LABELS) as (keyof DesignScores)[];
  // A perfect room does not need six full bars arguing with it.
  const perfect = report.score === 100 || keys.every((key) => report.scores[key] === 10);
  // The two newest saved layouts of this room, in the order they were saved.
  const pair = [...scene.variants.filter((variant) => variant.roomId === room.id)]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, 2)
    .reverse();

  return (
    <div className="flex min-h-0 flex-col gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display truncate text-[19px] leading-tight text-ink">{room.name}</h3>
          <p className="label-caps mt-1.5">
            {roomAreaM2(room).toFixed(1)} m² · {plural(items, "item")}
          </p>
        </div>
        <div className="text-right">
          <p className="numerals text-[26px] leading-none text-ink">{report.score}</p>
          <p className="label-caps mt-1 text-ink-faint">/ 100</p>
        </div>
      </div>

      <p className="numerals text-[12px] text-ink-muted">{wallsLine(room)}</p>
      <p className="text-[12.5px] leading-relaxed text-ink-muted">{report.summary}</p>

      {perfect ? (
        <p className="flex items-center gap-1.5 rounded-chip border border-sage/35 bg-sage/10 px-2.5 py-2 text-[12.5px] text-ink">
          <IconCheck size={14} className="shrink-0 text-sage" />
          Nothing to fix — all six measures are at 10.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {keys.map((key) => (
            <ScoreBar key={key} label={SCORE_LABELS[key]} value={report.scores[key]} />
          ))}
        </ul>
      )}

      {pair.length === 2 ? (
        <Button
          size="sm"
          icon={IconCompare}
          onClick={() => hearthStore.getState().setUi({
            compare: { left: pair[0]?.name ?? "", right: pair[1]?.name ?? "", roomId: room.id },
          })}
        >
          Compare “{pair[0]?.name}” with “{pair[1]?.name}”
        </Button>
      ) : null}

      {report.suggestions[0] ? (
        <div className="rounded-chip border border-hairline bg-plaster/60 p-2.5">
          <p className="label-caps mb-1.5">Next move</p>
          <p className="text-[12.5px] leading-snug text-ink">{report.suggestions[0]}</p>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="label-caps">{plural(conflicts.length, "conflict")} in this room</span>
          <ul className="flex flex-col gap-2">
            {conflicts.map((conflict) => (
              <ConflictRow key={`${conflict.kind}-${conflict.items.join("-")}`} conflict={conflict} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Pinned actions for the selected item, so they never scroll out of the inspector. */
function ItemActions({ item, product }: { item: Furniture; product: CatalogItem }) {
  const cartLines = useHearthStore((state) => state.cart.lines);
  const inCart = cartLines.some((line) => line.itemId === item.id || line.handle === product.id);
  return (
    <div className="flex items-center gap-1.5">
      <IconButton icon={IconRotateRight} label="Turn 90 degrees clockwise" size="sm" onClick={() => rotate(item, product)} />
      <IconButton
        icon={item.locked ? IconLock : IconUnlock}
        label={item.locked ? "Unlock this item" : "Lock this item so arrange keeps it"}
        size="sm"
        active={item.locked === true}
        onClick={() => hearthStore.getState().setLocked("human", item.id, !item.locked)}
      />
      <IconButton icon={IconTrash} label="Remove this item" size="sm" onClick={() => remove(item, product)} />
      <span className="flex-1" />
      {inCart ? (
        <Tag tone="sage" icon={IconCheck}>In cart</Tag>
      ) : (
        <Button
          size="sm"
          icon={IconCart}
          onClick={() => {
            void cartOps.add({ product, colorway: item.colorway, itemId: item.id }).then((ok) => {
              if (ok) hearthStore.getState().setUi({ cartOpen: true });
            });
          }}
        >
          Add to cart
        </Button>
      )}
    </div>
  );
}

function ItemCard({ item, product }: { item: Furniture; product: CatalogItem }) {
  const conflicts = useConflicts();
  const mine = useMemo(() => conflictsForItem(conflicts, item.id), [conflicts, item.id]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start gap-3">
        <CatalogThumb productId={product.id} category={product.category} colorway={item.colorway} name={product.name} width={78} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-display truncate text-[17px] leading-tight text-ink">{product.name}</h3>
          <p className="label-caps">{categoryLabel(product.category)} · {item.id}</p>
          <p className="numerals text-[15px] text-ink">{usd(product.price ?? 0)}</p>
        </div>
      </div>

      {mine.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="label-caps">{plural(mine.length, "conflict")}</span>
          <ul className="flex flex-col gap-2">
            {mine.map((conflict) => (
              <ConflictRow key={`${conflict.kind}-${conflict.items.join("-")}`} conflict={conflict} />
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="flex flex-col gap-1.5 border-y border-hairline py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="label-caps">Footprint</dt>
          <dd className="numerals text-[12.5px] text-ink">{dimsFull(product.dims)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="label-caps">Position</dt>
          <dd className="numerals text-[12.5px] text-ink">
            {Math.round(item.pos.x)}, {Math.round(item.pos.y)} cm · {item.rotation}°
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="label-caps">Front clearance</dt>
          <dd className="numerals text-[12.5px] text-ink">{product.clearanceFront} cm</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        <span className="label-caps">Colourway</span>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Colourway">
          {product.colorways.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-label={colorwayLabel(option.id)}
              aria-pressed={option.id === item.colorway}
              onClick={() => hearthStore.getState().setColorway("human", item.id, option.id)}
              className={`flex h-7 items-center gap-1.5 rounded-pill border px-2 text-[11.5px] transition-colors duration-200 ease-out-soft ${
                option.id === item.colorway ? "border-terracotta/45 bg-terracotta/10 text-ink" : "border-hairline text-ink-muted hover:text-ink"
              }`}
            >
              <span className="h-3 w-3 rounded-pill border border-charcoal/20" style={{ background: option.hex }} />
              {colorwayLabel(option.id)}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

export function Inspector({ className = "", collapsible = false }: { className?: string; collapsible?: boolean }) {
  const scene = useHearthStore((state) => state.scene);
  const catalogItems = useHearthStore((state) => state.catalog);
  const home = useHomeFocus();
  const selectedId = scene.meta.selection.itemId;
  const item = scene.furniture.find((candidate) => candidate.id === selectedId);
  const product = item ? createCatalog(catalogItems).byId(item.catalogId) : undefined;
  const room = scene.rooms.find((candidate) => candidate.id === scene.meta.activeRoomId) ?? scene.rooms[0];

  return (
    <Panel
      label="Inspector"
      className={className}
      actions={
        <>
          {item ? (
            <button
              type="button"
              onClick={() => hearthStore.getState().setSelection("human", { itemId: undefined })}
              className="label-caps rounded-chip px-1.5 py-1 transition-colors duration-200 ease-out-soft hover:text-ink"
            >
              Clear
            </button>
          ) : null}
          {collapsible ? (
            <IconButton
              icon={IconPanelRight}
              label="Collapse the side panels"
              size="sm"
              onClick={() => hearthStore.getState().setUi({ inspectorCollapsed: true })}
            />
          ) : null}
        </>
      }
      bodyClassName="overflow-y-auto panel-scroll"
      fade
      footer={item && product ? <ItemActions item={item} product={product} /> : null}
    >
      {item && product ? (
        <ItemCard item={item} product={product} />
      ) : home ? (
        <HomeCard scene={scene} catalogItems={catalogItems} />
      ) : room ? (
        <RoomCard room={room} />
      ) : (
        <EmptyState title="No room yet." hint="Ask your agent to apply a floor-plan template." />
      )}
    </Panel>
  );
}
