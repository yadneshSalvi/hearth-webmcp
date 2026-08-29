"use client";
/**
 * Furniture layer: one item per `scene.furniture` entry, GLB when the asset exists and the designed
 * procedural stand-in otherwise, plus the STYLE.md §3 choreography — drop-in with a dust ring,
 * arcing moves with an `arrange_room` stagger, shrink-and-fade removals, hover lift and the ochre
 * selection halo.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animated, to, useSpring } from "@react-spring/three";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import type { MeshBasicMaterial } from "three";
import { footprint, polyBBox } from "../engine/geometry";
import type { CatalogItem, Furniture as FurnitureData, Room } from "../engine/types";
import { mix, motion as motionTokens, palette } from "../tokens";
import { hearthStore } from "../state/store";
import { GlbBoundary, useGlbState, useNormalizedGlb } from "./assets";
import { setPointerHover, useIsHovered } from "./hover";
import { M, clamp, rotationRadians, stackElevationCm } from "./math";
import type { Vec3 } from "./math";
import { Placeholder } from "./Placeholder";
import { useSoftRing } from "./textures";
import { useFramedBox } from "./framing";
import { useFurniture, useLatestActivity, useMeta, useProductLookup, useRooms } from "./useSceneStore";

/**
 * Previous world positions for the move choreography. Module scope on purpose: the furniture layer
 * is a singleton and this must be readable while rendering, which a React ref must not be.
 */
const lastPositions = new Map<string, Vec3>();

/** How far furniture outside the framed room blends toward plaster, so the hero room reads first. */
const RECEDE = 0.34;

const HOVER_LIFT = 0.02;
const DROP_HEIGHT = 0.4;
const ARC_HEIGHT = 0.14;
const EXIT_MS = 240;

interface Resolved {
  item: FurnitureData;
  room: Room;
  product: CatalogItem;
  /** Item centre in world metres, already elevated onto any surface beneath it. */
  position: Vec3;
  footprintM: { w: number; d: number };
}

/** Resolves one furniture record into world-space render data, or undefined if the scene is stale. */
function resolveOne(
  item: FurnitureData,
  rooms: Room[],
  byId: (id: string) => CatalogItem | undefined,
  furniture: FurnitureData[],
): Resolved | undefined {
  const room = rooms.find((candidate) => candidate.id === item.roomId);
  const product = byId(item.catalogId);
  if (!room || !product) return undefined;
  const elevation = stackElevationCm(item, product, { furniture }, byId);
  const bounds = polyBBox(footprint(item, product));
  return {
    item,
    room,
    product,
    position: [(room.origin.x + item.pos.x) * M, elevation * M, (room.origin.y + item.pos.y) * M],
    footprintM: { w: (bounds.maxX - bounds.minX) * M, d: (bounds.maxY - bounds.minY) * M },
  };
}

/** Every placed and ghost item in the home. */
export function Furniture() {
  const furniture = useFurniture();
  const rooms = useRooms();
  const byId = useProductLookup();
  const meta = useMeta();
  const activity = useLatestActivity();
  const framed = useFramedBox();

  const resolved = useMemo(
    () =>
      furniture
        .map((item) => resolveOne(item, rooms, byId, furniture))
        .filter((entry): entry is Resolved => entry !== undefined),
    [furniture, rooms, byId],
  );

  const delays = useMoveChoreography(resolved, activity.tool);
  const exiting = useExitingItems();
  const focusRoomId = framed.roomId ?? meta.activeRoomId;

  return (
    <group name="furniture">
      {resolved.map((entry) => (
        <FurniturePiece
          key={entry.item.id}
          entry={entry}
          moveDelay={delays.get(entry.item.id) ?? 0}
          selected={meta.selection.itemId === entry.item.id}
          storeHoverId={meta.selection.hoverItemId}
          recede={entry.item.roomId === focusRoomId ? 0 : RECEDE}
        />
      ))}
      {exiting.map((entry) => (
        <FurniturePiece key={`exit-${entry.item.id}`} entry={entry} moveDelay={0} selected={false} exiting />
      ))}
    </group>
  );
}

interface PieceProps {
  entry: Resolved;
  moveDelay: number;
  selected: boolean;
  storeHoverId?: string;
  exiting?: boolean;
  recede?: number;
}

function FurniturePiece({ entry, moveDelay, selected, storeHoverId, exiting = false, recede = 0 }: PieceProps) {
  const { item, product, position, footprintM } = entry;
  const ghost = item.status === "ghost";
  const calm = ghost || exiting;
  const hovered = useIsHovered(item.id, storeHoverId);
  const [dust, setDust] = useState(!calm);

  const [{ drop, bounce }] = useSpring(
    () => ({
      from: { drop: calm ? 0 : 1, bounce: calm ? 1 : 0.96 },
      to: calm ? { drop: 0, bounce: 1 } : [{ drop: 0, bounce: 1.03 }, { drop: 0, bounce: 1 }],
      config: motionTokens.spring,
      onRest: () => setDust(false),
    }),
    [],
  );

  const previous = useRef<Vec3>(position);
  const [{ ox, oy, oz, arc }, glideApi] = useSpring(() => ({ ox: 0, oy: 0, oz: 0, arc: 1 }), []);
  useLayoutEffect(() => {
    const last = previous.current;
    if (last[0] === position[0] && last[1] === position[1] && last[2] === position[2]) return;
    previous.current = position;
    glideApi.start({
      from: { ox: last[0] - position[0], oy: last[1] - position[1], oz: last[2] - position[2], arc: 0 },
      to: { ox: 0, oy: 0, oz: 0, arc: 1 },
      delay: moveDelay,
      config: motionTokens.spring,
    });
  }, [position, moveDelay, glideApi]);

  const [{ exit }, exitApi] = useSpring(() => ({ exit: 1, config: { duration: EXIT_MS } }), []);
  useEffect(() => {
    if (exiting) exitApi.start({ exit: 0.4 });
  }, [exiting, exitApi]);

  const { hoverY } = useSpring({ hoverY: hovered && !calm ? HOVER_LIFT : 0, config: motionTokens.springSoft });
  const bodyY = to([drop, hoverY, arc], (d, h, a) => d * DROP_HEIGHT + h + ARC_HEIGHT * Math.sin(Math.PI * clamp(a, 0, 1)));
  const bodyScale = to([bounce, exit], (b, e) => b * e);

  const onOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!calm) setPointerHover(item.id);
  };
  const onOut = () => setPointerHover(undefined);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (calm) return;
    hearthStore.getState().setSelection("human", { itemId: item.id, roomId: item.roomId });
  };

  return (
    <group name={`item-${item.id}`} position={position} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
      <animated.group position-x={ox} position-y={oy} position-z={oz}>
        <animated.group position-y={bodyY} scale={bodyScale}>
          <group rotation-y={rotationRadians(item.rotation)}>
            <ItemBody product={product} colorway={item.colorway} ghost={ghost} recede={recede} />
          </group>
        </animated.group>
      </animated.group>
      {selected && !ghost ? <Halo width={footprintM.w} depth={footprintM.d} /> : null}
      {dust && !calm ? <DustRing width={footprintM.w} depth={footprintM.d} /> : null}
    </group>
  );
}

/** GLB when the asset is on disk, the procedural placeholder otherwise. */
function ItemBody({ product, colorway, ghost, recede }: { product: CatalogItem; colorway: string; ghost: boolean; recede: number }) {
  const state = useGlbState(product.glb);
  const hex = product.colorways.find((entry) => entry.id === colorway)?.hex ?? product.colorways[0]?.hex ?? palette.oak;
  const fallback = <Placeholder category={product.category} dims={product.dims} colorwayHex={hex} ghost={ghost} recede={recede} />;
  if (state !== "present") return fallback;
  return (
    <GlbBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <GlbBody product={product} hex={hex} ghost={ghost} />
      </Suspense>
    </GlbBoundary>
  );
}

function GlbBody({ product, hex, ghost }: { product: CatalogItem; hex: string; ghost: boolean }) {
  const model = useNormalizedGlb(product, hex, ghost);
  return <primitive object={model} />;
}

/** Soft ochre halo on the floor beneath the selected item — no hard outline. */
function Halo({ width, depth }: { width: number; depth: number }) {
  const map = useSoftRing();
  const size = Math.max(width, depth) + 0.36;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.036, 0]} renderOrder={2}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={map ?? undefined} color={palette.ochre} transparent opacity={0.6} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** One-shot dust ring pulse when an item lands. */
function DustRing({ width, depth }: { width: number; depth: number }) {
  const map = useSoftRing();
  const size = Math.max(width, depth) + 0.55;
  const materialRef = useRef<MeshBasicMaterial>(null);
  const [{ pulse }] = useSpring(() => ({ from: { pulse: 0 }, to: { pulse: 1 }, config: { duration: 760 } }), []);
  useFrame(() => {
    if (materialRef.current) materialRef.current.opacity = 0.55 * (1 - pulse.get());
  });
  return (
    <animated.mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} renderOrder={1} scale={pulse.to((value) => 0.45 + value * 1.1)}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial
        ref={materialRef}
        map={map ?? undefined}
        color={mix(palette.plaster, palette.oak, 0.25)}
        transparent
        opacity={0.55}
        depthWrite={false}
        toneMapped={false}
      />
    </animated.mesh>
  );
}

/**
 * `arrange_room` is choreographed: moved items glide with a 60 ms stagger, longest distance last
 * (STYLE.md §3). Any other move starts immediately.
 */
function useMoveChoreography(resolved: Resolved[], tool?: string): Map<string, number> {
  const delays = useMemo(() => {
    const result = new Map<string, number>();
    if (tool !== "arrange_room") return result;
    const moved: { id: string; distance: number }[] = [];
    for (const entry of resolved) {
      const last = lastPositions.get(entry.item.id);
      if (!last) continue;
      const distance = Math.hypot(entry.position[0] - last[0], entry.position[2] - last[2]);
      if (distance > 1e-4) moved.push({ id: entry.item.id, distance });
    }
    moved
      .sort((a, b) => a.distance - b.distance)
      .forEach((entry, index) => result.set(entry.id, index * motionTokens.arrangeStaggerMs));
    return result;
  }, [resolved, tool]);
  useEffect(() => {
    lastPositions.clear();
    for (const entry of resolved) lastPositions.set(entry.item.id, entry.position);
  }, [resolved]);
  return delays;
}

/**
 * Keeps a just-removed item mounted for 240 ms so it can shrink and fade out, driven by the store
 * transition itself. Transient exit state only — the store stays the source of truth for what exists.
 */
function useExitingItems(): Resolved[] {
  const [exiting, setExiting] = useState<Resolved[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = hearthStore.subscribe((state, previous) => {
      if (state.scene.furniture === previous.scene.furniture) return;
      const alive = new Set(state.scene.furniture.map((item) => item.id));
      const byId = (id: string) => previous.catalog.find((product) => product.id === id);
      const gone = previous.scene.furniture
        .filter((item) => !alive.has(item.id) && item.status === "placed")
        .map((item) => resolveOne(item, previous.scene.rooms, byId, previous.scene.furniture))
        .filter((entry): entry is Resolved => entry !== undefined);
      if (gone.length === 0) return;
      setExiting((current) => [...current, ...gone]);
      const ids = new Set(gone.map((entry) => entry.item.id));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setExiting((current) => current.filter((entry) => !ids.has(entry.item.id)));
      }, EXIT_MS + 60);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return exiting;
}
