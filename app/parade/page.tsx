"use client";
/**
 * Catalog parade — a dev-only harness that walks every catalog id through the real GLB pipeline so
 * mis-tints, wrong orientation and scale mistakes are visible side by side. Eight items per screen,
 * every one at rotation 0 (front must face south), tall items in the far row so nothing occludes.
 * Phase 3 does not ship this route.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { CatalogItem, Furniture, Room, Scene } from "@/src/engine/types";
import { hearthStore, useHearthStore } from "@/src/state/store";

const Studio = dynamic(() => import("@/src/scene/Studio"), { ssr: false });

const PER_SCREEN = 8;
const COLUMNS = 4;
const COLUMN_STEP = 290;
const ROW_Y = [160, 500] as const;
const ROOM_WIDTH = COLUMNS * COLUMN_STEP + 180;
const ROOM_DEPTH = 660;

interface Slot {
  item: Furniture;
  product: CatalogItem;
  row: 0 | 1;
  column: number;
}

/** Lays out one screen of the parade: tallest four at the back, shortest four at the front. */
function buildSlots(products: CatalogItem[]): Slot[] {
  const ordered = [...products].sort((a, b) => b.dims.h - a.dims.h);
  const back = ordered.slice(0, COLUMNS);
  const front = ordered.slice(COLUMNS);
  const slots: Slot[] = [];
  ([back, front] as const).forEach((group, rowIndex) => {
    group.forEach((product, column) => {
      slots.push({
        product,
        row: rowIndex as 0 | 1,
        column,
        item: {
          id: `parade-${product.id}`,
          catalogId: product.id,
          roomId: "parade",
          pos: { x: 90 + COLUMN_STEP / 2 + column * COLUMN_STEP, y: ROW_Y[rowIndex as 0 | 1] },
          rotation: 0,
          colorway: product.colorways[0]?.id ?? "oak",
          status: "placed",
        },
      });
    });
  });
  return slots;
}

function paradeScene(slots: Slot[]): Scene {
  const room: Room = {
    id: "parade",
    name: "Catalog parade",
    type: "studio",
    poly: [
      { x: 0, y: 0 },
      { x: ROOM_WIDTH, y: 0 },
      { x: ROOM_WIDTH, y: ROOM_DEPTH },
      { x: 0, y: ROOM_DEPTH },
    ],
    origin: { x: 0, y: 0 },
    floor: "pale-oak",
    wallColor: "plaster",
  };
  return {
    rooms: [room],
    openings: [],
    furniture: slots.map((slot) => slot.item),
    variants: [],
    meta: {
      mode: "design",
      view: "dollhouse",
      yaw: "sw",
      timeOfDay: "noon",
      paletteId: "warm-clay",
      accessibilityMode: false,
      activeRoomId: "parade",
      selection: {},
      template: "studio",
    },
  };
}

/** The parade route. */
export default function ParadePage() {
  const catalog = useHearthStore((state) => state.catalog);
  const view = useHearthStore((state) => state.scene.meta.view);
  const [screen, setScreen] = useState(0);
  const screens = Math.max(1, Math.ceil(catalog.length / PER_SCREEN));
  const slots = useMemo(
    () => buildSlots(catalog.slice(screen * PER_SCREEN, screen * PER_SCREEN + PER_SCREEN)),
    [catalog, screen],
  );

  useEffect(() => {
    hearthStore.getState().resetScene(paradeScene(slots));
  }, [slots]);

  const rows = [slots.filter((slot) => slot.row === 0), slots.filter((slot) => slot.row === 1)];

  return (
    <main className="relative h-full w-full overflow-hidden" data-lab data-parade-screen={screen}>
      <Studio />
      <div className="glass absolute top-5 left-5 z-30 flex items-center gap-3 px-4 py-2.5">
        <span className="label-caps">Catalog parade</span>
        <span className="numerals text-ink text-[13px]">
          {screen + 1} / {screens}
        </span>
        <button
          type="button"
          onClick={() => setScreen((value) => Math.max(0, value - 1))}
          className="rounded-chip border-hairline text-ink-muted hover:text-ink border px-2 py-1 text-[11px]"
          aria-label="Previous parade screen"
        >
          prev
        </button>
        <button
          type="button"
          onClick={() => setScreen((value) => Math.min(screens - 1, value + 1))}
          className="rounded-chip border-hairline text-ink-muted hover:text-ink border px-2 py-1 text-[11px]"
          aria-label="Next parade screen"
        >
          next
        </button>
        <button
          type="button"
          onClick={() => hearthStore.getState().setView("human", { view: view === "plan" ? "dollhouse" : "plan" })}
          className="rounded-chip border-hairline text-ink-muted hover:text-ink border px-2 py-1 text-[11px]"
          aria-label="Toggle the parade view"
        >
          {view === "plan" ? "dollhouse" : "plan"}
        </button>
      </div>
      <div className="glass absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 flex-col gap-2 px-5 py-3">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-4">
            <span className="label-caps w-24 shrink-0 text-[10px]">{index === 0 ? "far row" : "near row"}</span>
            {row.map((slot) => (
              <span key={slot.item.id} className="text-ink w-[168px] shrink-0 text-[11px]">
                {slot.product.id}
                <span className="text-ink-faint"> · {slot.item.colorway}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
