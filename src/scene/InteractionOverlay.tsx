"use client";
/**
 * The measured-drawing layer a drag draws over the floor: dimension lines from every footprint
 * edge to the wall it faces, the ochre alignment guide, the neighbour-gap callout, the refusal
 * chip, the lifted proxy of the item in hand and the floating mini-toolbar for a selection.
 *
 * Everything here is geometry the pointer already resolved (see interactionDrag.ts); this file only
 * draws. Lengths arrive in room-local centimetres and are converted to metres exactly once.
 */
import { Suspense, useEffect } from "react";
import { animated, to, useSpring } from "@react-spring/three";
import { Html, Line } from "@react-three/drei";
import { rotateDims } from "../engine/geometry";
import type { CatalogItem, Room, Rotation, Vec2 } from "../engine/types";
import { mix, motion as motionTokens, palette } from "../tokens";
import { GlbBoundary, useGlbState, useNormalizedGlb } from "./assets";
import type { Pose } from "./interactionDrag";
import { roomToWorldCm } from "./interactionMath";
import type { AlignGuide, DimensionLine, NeighbourGap } from "./interactionMath";
import { M, nearestAngle, rotationRadians } from "./math";
import { Placeholder } from "./Placeholder";
import { useSoftRing } from "./textures";

/** Diagram heights in metres, stacked above the conflict overlays so nothing is buried. */
const DIM_Y = 0.06;
const GUIDE_Y = 0.064;
const TICK_CM = 9;
/** How far a dimension line must run before its numerals are worth drawing. */
const LABEL_MIN_CM = 12;

type Point = [number, number, number];

function toPoint(room: Room, local: Vec2, y: number): Point {
  return [(room.origin.x + local.x) * M, y, (room.origin.y + local.y) * M];
}

/** Thin charcoal dimension lines with end ticks and Fraunces numerals in centimetres. */
export function DimensionOverlay({ room, dims }: { room: Room; dims: DimensionLine[] }) {
  const segments: Point[] = [];
  for (const line of dims) {
    segments.push(toPoint(room, line.a, DIM_Y), toPoint(room, line.b, DIM_Y));
    const half = TICK_CM / 2;
    const across = (point: Vec2): [Vec2, Vec2] =>
      line.axis === "y"
        ? [{ x: point.x - half, y: point.y }, { x: point.x + half, y: point.y }]
        : [{ x: point.x, y: point.y - half }, { x: point.x, y: point.y + half }];
    for (const end of [line.a, line.b]) {
      const [tickStart, tickEnd] = across(end);
      segments.push(toPoint(room, tickStart, DIM_Y), toPoint(room, tickEnd, DIM_Y));
    }
  }
  if (segments.length === 0) return null;
  return (
    <group name="drag-dimensions">
      <Line segments points={segments} color={palette.charcoal} lineWidth={1.2} transparent opacity={0.5} toneMapped={false} />
      {dims
        .filter((line) => line.cm >= LABEL_MIN_CM)
        .map((line) => (
          <Html
            key={line.side}
            position={toPoint(room, { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 }, DIM_Y)}
            center
            pointerEvents="none"
            zIndexRange={[24, 4]}
          >
            <span className="numerals pointer-events-none select-none whitespace-nowrap rounded-pill border border-hairline bg-glass px-[7px] py-[2px] text-[11px] leading-[1.35] text-ink">
              {line.cm} cm
            </span>
          </Html>
        ))}
    </group>
  );
}

/** Ochre alignment guides: the edge or centre the item has locked onto. */
export function GuideOverlay({ room, guides }: { room: Room; guides: AlignGuide[] }) {
  const segments: Point[] = [];
  for (const guide of guides) {
    const from = guide.axis === "x" ? { x: guide.at, y: guide.from } : { x: guide.from, y: guide.at };
    const to = guide.axis === "x" ? { x: guide.at, y: guide.to } : { x: guide.to, y: guide.at };
    segments.push(toPoint(room, from, GUIDE_Y), toPoint(room, to, GUIDE_Y));
  }
  if (segments.length === 0) return null;
  return (
    <Line
      name="drag-guides"
      segments
      points={segments}
      color={palette.ochre}
      lineWidth={2}
      transparent
      opacity={0.9}
      toneMapped={false}
    />
  );
}

/** Dotted dusty-blue callout for the gap to the nearest neighbour on the drag axis. */
export function GapOverlay({ room, gap }: { room: Room; gap: NeighbourGap }) {
  return (
    <group name="drag-gap">
      <Line
        points={[toPoint(room, gap.a, GUIDE_Y), toPoint(room, gap.b, GUIDE_Y)]}
        color={palette.dustyBlue}
        lineWidth={1.6}
        dashed
        dashSize={0.05}
        gapSize={0.05}
        transparent
        opacity={0.9}
        toneMapped={false}
      />
      <Html
        position={toPoint(room, { x: gap.a.x + (gap.b.x - gap.a.x) * 0.35, y: gap.a.y + (gap.b.y - gap.a.y) * 0.35 }, GUIDE_Y)}
        center
        pointerEvents="none"
        zIndexRange={[24, 4]}
      >
        <span className="numerals pointer-events-none -translate-y-4 select-none whitespace-nowrap rounded-pill border border-hairline bg-glass px-[7px] py-[2px] text-[11px] leading-[1.35] text-dusty-blue">
          {gap.cm} cm
        </span>
      </Html>
    </group>
  );
}

/** The rose chip that names the rule a position breaks, hovering just above the item. */
export function ReasonChip({ position, reason }: { position: Point; reason: string }) {
  return (
    <Html position={position} center pointerEvents="none" zIndexRange={[28, 8]}>
      <span
        className="pointer-events-none flex select-none items-center gap-1.5 whitespace-nowrap rounded-pill border border-hairline bg-glass px-2.5 py-1 text-[11px] leading-[1.35] text-rose shadow-chip"
        role="status"
      >
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-pill bg-rose" />
        {reason}
      </span>
    </Html>
  );
}

/**
 * A soft ring on the floor under the item in hand: ochre while valid, rose while refused. The unit
 * plane is scaled to the item's rotated footprint so a 220 cm sofa gets a sofa-shaped glow rather
 * than a two-metre circle of colour.
 */
export function DragRing({ width, depth, valid }: { width: number; depth: number; valid: boolean }) {
  const map = useSoftRing();
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.038, 0]}
      scale={[width + 0.34, depth + 0.34, 1]}
      renderOrder={4}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={map ?? undefined}
        color={valid ? palette.ochre : palette.rose}
        transparent
        opacity={valid ? 0.6 : 0.55}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * The body of the item in hand. Same GLB and same procedural stand-in as the furniture layer, so
 * lifting an item off the floor never changes what it looks like — only a refused position tints
 * it toward rose.
 */
export function ProxyBody({ product, colorway, invalid }: { product: CatalogItem; colorway: string; invalid: boolean }) {
  const state = useGlbState(product.glb);
  const base = product.colorways.find((entry) => entry.id === colorway)?.hex ?? product.colorways[0]?.hex ?? palette.oak;
  const hex = invalid ? mix(base, palette.rose, 0.3) : base;
  const fallback = <Placeholder category={product.category} dims={product.dims} colorwayHex={hex} />;
  if (state !== "present") return fallback;
  return (
    <GlbBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <ProxyGlb product={product} hex={hex} />
      </Suspense>
    </GlbBoundary>
  );
}

function ProxyGlb({ product, hex }: { product: CatalogItem; hex: string }) {
  const model = useNormalizedGlb(product, hex, false);
  return <primitive object={model} />;
}

export interface DragProxyProps {
  product: CatalogItem;
  colorway: string;
  valid: boolean;
  /** Item centre in world centimetres. */
  world: Vec2;
  /** Surface the item is resting on, in metres; 0 on the floor. */
  elevation: number;
  /** Extra height while the item is in hand; 0 once it is being handed back. */
  lift: number;
  rotation: Rotation;
  /** true for one refused release: spring home with a short shake. */
  rejected: boolean;
  reduced: boolean;
  reason?: string;
}

/**
 * The item in hand: the same body the furniture layer would draw, floating above its ochre ring,
 * with the refusal chip riding along so it tracks the spring rather than the last committed pose.
 */
export function DragProxy({ product, colorway, valid, world, elevation, lift, rotation, rejected, reduced, reason }: DragProxyProps) {
  const height = elevation + lift;
  const extents = rotateDims(product.dims, rotation);
  const [spring, api] = useSpring(() => ({
    px: world.x * M,
    py: height,
    pz: world.y * M,
    ry: rotationRadians(rotation),
    shake: 0,
    config: motionTokens.spring,
  }), []);

  useEffect(() => {
    api.start({
      px: world.x * M,
      py: height,
      pz: world.y * M,
      ry: nearestAngle(spring.ry.get(), rotationRadians(rotation)),
      config: motionTokens.spring,
      immediate: reduced,
    });
  }, [api, height, reduced, rotation, spring, world.x, world.y]);

  useEffect(() => {
    if (!rejected || reduced) return;
    api.start({ from: { shake: 0 }, to: { shake: 1 }, config: { duration: REJECT_MS } });
  }, [api, rejected, reduced]);

  return (
    <animated.group
      name="drag-proxy"
      position-x={to([spring.px, spring.shake], (x, s) => x + Math.sin(s * Math.PI * 3) * SHAKE_M * (1 - s))}
      position-y={spring.py}
      position-z={spring.pz}
    >
      <animated.group rotation-y={spring.ry}>
        <ProxyBody product={product} colorway={colorway} invalid={!valid} />
      </animated.group>
      <group position-y={-height}>
        <DragRing width={extents.w * M} depth={extents.d * M} valid={valid} />
      </group>
      {reason && !rejected ? <ReasonChip position={[0, product.dims.h * M + 0.22, 0]} reason={reason} /> : null}
    </animated.group>
  );
}

/** Spring-back plus shake after a refused release (STYLE.md §3). */
const REJECT_MS = 240;
const SHAKE_M = 0.016;

export interface ToolbarProps {
  position: Point;
  locked: boolean;
  onRotate: () => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const BUTTON =
  "flex h-8 w-8 items-center justify-center rounded-pill text-ink transition-colors duration-[180ms] ease-out-soft hover:bg-ochre/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ochre";

/**
 * Floating glass pill over the selected item: rotate, lock, duplicate, delete. Real buttons, so
 * every action is reachable with the keyboard alone and announced by name.
 */
export function MiniToolbar({ position, locked, onRotate, onToggleLock, onDuplicate, onDelete }: ToolbarProps) {
  return (
    <Html position={position} center zIndexRange={[30, 10]}>
      <div
        className="glass flex select-none items-center gap-1 rounded-pill p-1.5"
        role="toolbar"
        aria-label="Selected item actions"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={BUTTON} title="Rotate 90° (R)" aria-label="Rotate 90 degrees" onClick={onRotate}>
          <Icon path="M12 5.5V3l4 3-4 3V6.5a5.5 5.5 0 1 0 5.5 5.5" />
        </button>
        <button
          type="button"
          className={BUTTON}
          title={locked ? "Unlock" : "Lock in place"}
          aria-label={locked ? "Unlock item" : "Lock item in place"}
          aria-pressed={locked}
          onClick={onToggleLock}
        >
          {locked ? (
            <Icon path="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" />
          ) : (
            <Icon path="M8.5 11V8a5 5 0 0 1 9.5-2M6 11h12v9H6z" />
          )}
        </button>
        <button type="button" className={BUTTON} title="Duplicate" aria-label="Duplicate item" onClick={onDuplicate}>
          <Icon path="M9 9h10v10H9zM5 15V5h10" />
        </button>
        <button type="button" className={BUTTON} title="Delete (Del)" aria-label="Delete item" onClick={onDelete}>
          <Icon path="M6 8h12M9.5 8V6h5v2M8 8l.8 11h6.4L16 8" />
        </button>
      </div>
    </Html>
  );
}

/**
 * The measured drawing for a catalog card hovering over the canvas. The ghost body itself is a
 * store ghost the furniture layer draws at 0.45 opacity; this adds the same dimension lines,
 * guides, gap and refusal chip a pointer drag gets.
 */
export function DropPreviewOverlay({ preview, room }: { preview: { pose: Pose; product: CatalogItem }; room: Room }) {
  const { pose, product } = preview;
  const world = roomToWorldCm(room, pose.pos);
  const extents = rotateDims(product.dims, pose.rotation);
  return (
    <group name="drop-preview">
      <group position={[world.x * M, 0, world.y * M]}>
        <DragRing width={extents.w * M} depth={extents.d * M} valid={pose.valid} />
        {pose.reason ? <ReasonChip position={[0, product.dims.h * M + 0.22, 0]} reason={pose.reason} /> : null}
      </group>
      <DimensionOverlay room={room} dims={pose.dims} />
      <GuideOverlay room={room} guides={pose.guides} />
      {pose.gap ? <GapOverlay room={room} gap={pose.gap} /> : null}
    </group>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}
