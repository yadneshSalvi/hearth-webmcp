"use client";
/**
 * The compare split view (TOOLS.md §29). Two saved variants of one room, photographed in turn and
 * laid over each other with a draggable split: the same frame, the same light, the same camera, so
 * the only thing that changes across the seam is the layout. Any layout change closes it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { createCatalog } from "../engine/catalog";
import { diffVariants } from "../engine/variants";
import type { VariantDiff } from "../engine/variants";
import { useReducedMotion } from "../scene/idle";
import { hearthStore, useHearthStore } from "../state/store";
import type { HearthStore, HearthUiState } from "../state/types";
import { motion } from "../tokens";
import { captureComparison } from "./compareCapture";
import { IconDrag } from "./icons";
import { Button } from "./primitives";
import { pushToast } from "./toast-bus";

type CompareState = NonNullable<HearthUiState["compare"]>;

function selectCompare(state: HearthStore): HearthUiState["compare"] {
  return state.ui.compare;
}

const STEP = 2;
const PAGE = 10;

function close(): void {
  hearthStore.getState().setUi({ compare: undefined });
}

/** One side's name plate, dotted in plum — the palette's variants-and-compare accent (STYLE.md §1). */
function NamePlate({ name, align }: { name: string; align: "left" | "right" }) {
  return (
    <span
      className={`pointer-events-none absolute top-5 flex max-w-[38%] items-center gap-2 rounded-pill border border-hairline bg-plaster/88 px-3 py-1.5 shadow-chip ${
        align === "left" ? "left-5" : "right-5"
      }`}
    >
      <span className="h-2 w-2 shrink-0 rounded-pill bg-plum" aria-hidden="true" />
      <span className="truncate text-[12.5px] font-medium text-ink">{name}</span>
    </span>
  );
}

function DiffCard({ diff, left, right, roomName }: { diff: VariantDiff; left: string; right: string; roomName: string }) {
  const stats: Array<{ label: string; value: number; names: string[] }> = [
    { label: `Only in ${left}`, value: diff.only_left.length, names: diff.only_left },
    { label: `Only in ${right}`, value: diff.only_right.length, names: diff.only_right },
    { label: "Moved", value: diff.moved.length, names: diff.moved },
  ];
  return (
    <div className="glass pointer-events-auto w-[min(560px,86vw)] px-4 py-3">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="label-caps truncate">{roomName} · what changed</p>
        <p className="label-caps shrink-0 text-ink-faint">drag the split</p>
      </div>
      <ul className="flex items-stretch gap-3">
        {stats.map((stat) => (
          <li key={stat.label} className="min-w-0 flex-1">
            <p className="numerals text-[22px] leading-none text-ink">{stat.value}</p>
            <p className="mt-1 truncate text-[11.5px] text-ink-muted" title={stat.label}>{stat.label}</p>
            <p className="mt-0.5 truncate text-[11px] text-ink-faint" title={stat.names.join(", ")}>
              {stat.names.length > 0 ? stat.names.join(", ") : "—"}
            </p>
          </li>
        ))}
      </ul>
      {diff.changed_colorway.length > 0 ? (
        <p className="mt-2.5 border-t border-hairline pt-2 text-[11.5px] text-ink-muted">
          Recoloured: {diff.changed_colorway.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function CompareOverlay({ compare }: { compare: CompareState }) {
  const variants = useHearthStore((state) => state.scene.variants);
  const catalogItems = useHearthStore((state) => state.catalog);
  const rooms = useHearthStore((state) => state.scene.rooms);
  const reduced = useReducedMotion();
  const [shots, setShots] = useState<{ left: string; right: string } | undefined>(undefined);
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);

  const roomName = rooms.find((room) => room.id === compare.roomId)?.name ?? "This room";

  const diff = useMemo<VariantDiff | undefined>(() => {
    const find = (name: string) => variants.find(
      (candidate) => candidate.roomId === compare.roomId && candidate.name.toLowerCase() === name.toLowerCase(),
    );
    const left = find(compare.left);
    const right = find(compare.right);
    if (!left || !right) return undefined;
    return diffVariants(left, right, createCatalog(catalogItems));
  }, [variants, catalogItems, compare]);

  // Photograph both layouts once per comparison, then put the room back (compareCapture.ts).
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    captureComparison(compare.roomId, compare.left, compare.right)
      .then((pair) => {
        if (cancelled) return;
        const left = URL.createObjectURL(pair.left);
        const right = URL.createObjectURL(pair.right);
        urls.push(left, right);
        setShots({ left, right });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        pushToast({
          title: "The comparison could not be composed",
          detail: error instanceof Error ? error.message : "The studio frame could not be captured.",
          tone: "warn",
        });
        close();
      });
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [compare]);

  // Any layout change closes the comparison, so what is on screen is never stale.
  useEffect(() => {
    if (!shots) return;
    let last = hearthStore.getState().scene.furniture;
    return hearthStore.subscribe((state) => {
      if (state.scene.furniture === last) return;
      last = state.scene.furniture;
      close();
    });
  }, [shots]);

  // The split handle takes focus as soon as there is something to compare, so ← and → work at once.
  useEffect(() => {
    if (shots) handle.current?.focus();
  }, [shots]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const setFromClientX = useCallback((clientX: number) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSplit(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    surface.current?.setPointerCapture(event.pointerId);
    setDragging(true);
    setFromClientX(event.clientX);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragging) setFromClientX(event.clientX);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    if (surface.current?.hasPointerCapture(event.pointerId)) surface.current.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const delta = event.key === "ArrowLeft" ? -STEP
      : event.key === "ArrowRight" ? STEP
        : event.key === "PageDown" ? -PAGE
          : event.key === "PageUp" ? PAGE
            : 0;
    if (delta === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") setSplit(0);
    else if (event.key === "End") setSplit(100);
    else setSplit((value) => Math.max(0, Math.min(100, value + delta)));
  };

  const slide = dragging || reduced ? undefined : `clip-path ${motion.base}ms ${motion.easeOut}`;

  return (
    <div
      className="fade-in fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Comparing ${compare.left} with ${compare.right} in ${roomName}`}
    >
      <div
        ref={surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute inset-0 touch-none bg-canvas-bottom select-none"
      >
        {shots ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shots.right} alt={`${compare.right} layout`} className="absolute inset-0 h-full w-full object-cover" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shots.left}
              alt={`${compare.left} layout`}
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)`, transition: slide }}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span
              aria-hidden="true"
              style={{ left: `${split}%`, transition: slide ? `left ${motion.base}ms ${motion.easeOut}` : undefined }}
              className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-[1px] bg-plaster shadow-chip ring-1 ring-hairline"
            />
            <button
              type="button"
              ref={handle}
              role="slider"
              aria-label={`Split between ${compare.left} and ${compare.right}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              aria-valuetext={`${Math.round(split)}% ${compare.left}`}
              onKeyDown={onHandleKey}
              style={{ left: `${split}%`, transition: slide ? `left ${motion.base}ms ${motion.easeOut}` : undefined }}
              className="absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-pill border border-hairline bg-plaster/92 text-plum shadow-panel"
            >
              <IconDrag size={18} />
            </button>
            <NamePlate name={compare.left} align="left" />
            <NamePlate name={compare.right} align="right" />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="glass rise-in px-6 py-5 text-center">
              <p className="font-display text-[16px] italic text-ink-muted">
                Photographing “{compare.left}” and “{compare.right}”…
              </p>
              <p className="label-caps mt-2">{roomName}</p>
            </div>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-3">
        {diff ? <DiffCard diff={diff} left={compare.left} right={compare.right} roomName={roomName} /> : null}
        <Button variant="primary" className="pointer-events-auto" aria-keyshortcuts="Escape" onClick={close}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** Mounted once by the shell; the overlay itself only exists while `ui.compare` is set. */
export function Compare() {
  const compare = useHearthStore(selectCompare);
  if (!compare) return null;
  return <CompareOverlay key={`${compare.roomId}|${compare.left}|${compare.right}`} compare={compare} />;
}
