"use client";
/**
 * Furniture layer: one item per `scene.furniture` entry, GLB when the asset exists and the designed
 * procedural stand-in otherwise, plus the STYLE.md §3 choreography — drop-in with a dust ring,
 * arcing moves with an `arrange_room` stagger, shrink-and-fade removals, hover lift and the ochre
 * selection halo. Under `prefers-reduced-motion` every pose is taken immediately and the change is
 * carried by a 240 ms cross-fade instead, with no dust and no bounce.
 *
 * A pose is only ever *glided* within one home (`homeToken`), and that is a measured rule rather
 * than taste. A glide across a template apply never arrived: three pieces left mid-flight by one
 * apply froze at the identical spring value (`bounce` 1.0301901104839772 on bed-1, side-table-1 and
 * wardrobe-1, with `ox`/`oz` still at their starting delta), and only one shared clock can stop
 * three independent springs at the same number. `@react-spring/three` runs `frameLoop: "demand"`
 * and is advanced from R3F's `addEffect`, so a spring moves only while the canvas draws: the apply's
 * own 600 ms camera tween keeps the loop alive, and whatever is still animating when that tween ends
 * stops where it stands — a seven-metre glide always outlives it. Left unexplained: 240 forced
 * `invalidate()` calls afterwards did not revive them.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animated, to, useSpring } from "@react-spring/three";
import { useFrame } from "@react-three/fiber";
import type { Group, MeshBasicMaterial } from "three";
import type { CatalogItem } from "../engine/types";
import { mix, motion as motionTokens, palette } from "../tokens";
import { useHearthStore } from "../state/store";
import { toolBatch } from "../state/tool-batch";
import { useNormalizedGlb } from "./assets";
import { GlbBoundary, useGlbState } from "./glb";
import { CHOREOGRAPHED_TOOL, noDelays, staggerDelays } from "./choreography";
import { useMaterialFade } from "./fade";
import { useIsHovered } from "./hover";
import { useReducedMotion } from "./idle";
import { useDraggingItemId } from "./interactionDrag";
import { FOREGROUND_FADE_MS, FOREGROUND_OFF, useForegroundOpacity } from "./foreground";
import { EXIT_MS, useExitingItems } from "./furnitureExit";
import { resolveOne } from "./furniturePose";
import type { Resolved } from "./furniturePose";
import { SELECTION_HALO_Y, clamp, rotationRadians } from "./math";
import { Placeholder } from "./Placeholder";
import { useSoftRing } from "./textures";
import { useFramedBox } from "./framing";
import { introRiseMetres } from "./intro";
import { useFurniture, useMeta, useProductLookup, useRooms } from "./useSceneStore";

/**
 * Previous world positions for the move choreography. Module scope on purpose: the furniture layer
 * is a singleton and this must be readable while rendering, which a React ref must not be.
 */
const lastPositions = new Map<string, [number, number, number]>();

/** How far furniture outside the framed room blends toward plaster, so the hero room reads first. */
const RECEDE = 0.34;

const HOVER_LIFT = 0.02;
const DROP_HEIGHT = 0.4;
const ARC_HEIGHT = 0.14;
/** Reduced motion carries every change as a cross-fade of this length instead of a glide. */
const CROSSFADE_MS = 240;

/** Every placed and ghost item in the home. */
export function Furniture() {
  const furniture = useFurniture();
  const rooms = useRooms();
  const byId = useProductLookup();
  const meta = useMeta();
  const framed = useFramedBox();
  const reduced = useReducedMotion();

  const resolved = useMemo(
    () =>
      furniture
        .map((item) => resolveOne(item, rooms, byId, furniture))
        .filter((entry): entry is Resolved => entry !== undefined),
    [furniture, rooms, byId],
  );

  const delays = useMoveChoreography(resolved, reduced);
  const exiting = useExitingItems();
  const focusRoomId = framed.roomId ?? meta.activeRoomId;
  const draggingId = useDraggingItemId();
  const dragging = useHearthStore((state) => state.ui.dragging);
  // How far each piece is faded for standing in front of the framed room (src/scene/foreground.ts).
  const foregroundOpacity = useForegroundOpacity(framed, meta);

  return (
    <IntroLift>
      {resolved.map((entry) => (
        <FurniturePiece
          key={entry.item.id}
          entry={entry}
          moveDelay={delays.get(entry.item.id) ?? 0}
          selected={meta.selection.itemId === entry.item.id}
          storeHoverId={meta.selection.hoverItemId}
          recede={entry.item.roomId === focusRoomId ? 0 : RECEDE}
          framed={entry.item.roomId === focusRoomId}
          hidden={entry.item.id === draggingId}
          invalid={dragging?.itemId === entry.item.id && dragging.valid === false}
          foreground={foregroundOpacity(entry)}
          homeToken={rooms}
          reduced={reduced}
        />
      ))}
      {exiting.map((entry) => (
        <FurniturePiece key={`exit-${entry.item.id}`} entry={entry} moveDelay={0} selected={false} exiting homeToken={rooms} reduced={reduced} />
      ))}
    </IntroLift>
  );
}

/**
 * The opening settle: the furniture layer starts 6 cm off the floor and comes to rest over two
 * seconds (STYLE.md §3, src/scene/intro.ts). One group transform read from the wall clock rather
 * than a spring per piece, so it is exactly zero the moment the settle ends and nothing placed
 * afterwards inherits any of it.
 */
function IntroLift({ children }: { children: React.ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    const lift = introRiseMetres();
    if (group.position.y !== lift) group.position.y = lift;
  });
  return (
    <group ref={ref} name="furniture">
      {children}
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
  /** True while the pointer is carrying this item: src/scene/Interaction.tsx draws it instead. */
  hidden?: boolean;
  /** True while the item's current position breaks a rule; the halo turns rose. */
  invalid?: boolean;
  /** `prefers-reduced-motion`, measured once for the whole layer. */
  reduced: boolean;
  /**
   * True when this piece is in the room the camera is framing. Framed pieces load their GLB at once;
   * the rest draw the placeholder until the warm-up wave reaches them (src/scene/assetWaves.ts).
   */
  framed?: boolean;
  /** 1 normally; less when this piece stands between the camera and the framed room. */
  foreground?: number;
  /**
   * The home this pose belongs to — `scene.rooms`, whose identity a template apply replaces and a
   * furniture move does not (immer only rebuilds the slice it touched). Items that survive by id —
   * `bed-1` exists in every bedroom plan — are unrelated objects in a different home, so they must
   * not glide there from wherever they stood in the plan that was just discarded.
   * Measured, not just taste: see the note on the frozen springs at the top of this file.
   */
  homeToken: object;
}

function FurniturePiece({ entry, moveDelay, selected, storeHoverId, exiting = false, recede = 0, hidden = false, invalid = false, reduced, framed = true, foreground = 1, homeToken }: PieceProps) {
  const { item, product, position, footprintM, stretch } = entry;
  const ghost = item.status === "ghost";
  // "Calm" bodies skip the drop: a ghost, an item on its way out, and every item under reduced
  // motion, which takes its pose immediately and cross-fades instead (STYLE.md §3).
  const calm = ghost || exiting || reduced;
  const hovered = useIsHovered(item.id, storeHoverId);
  const [dust, setDust] = useState(!calm);
  const body = useRef<Group>(null);

  const [{ drop, bounce }] = useSpring(
    () => ({
      from: { drop: calm ? 0 : 1, bounce: calm ? 1 : 0.96 },
      to: calm ? { drop: 0, bounce: 1 } : [{ drop: 0, bounce: 1.03 }, { drop: 0, bounce: 1 }],
      config: motionTokens.spring,
      onRest: () => setDust(false),
    }),
    [],
  );

  // One fade, two channels (src/scene/fade.ts): `run` carries the reduced-motion arrival at a new
  // pose and the removal that pairs with the exit shrink, `setBase` holds the cut-away fade for a
  // piece standing in front of the framed room. At 1 nothing is faded and no material is cloned.
  const { run: startFade, setBase, value: fadeValue } = useMaterialFade(body);
  useEffect(() => {
    setBase(foreground, reduced ? 0 : FOREGROUND_FADE_MS);
  }, [foreground, reduced, setBase]);

  // A body faded all the way out is switched off, once the fade has actually run: no draw call, and
  // `itemAt` stops picking it, so a click on the framed room reaches the framed room rather than the
  // wardrobe next door. Driven from the frame loop, like the walls' own cut-away.
  const dimRef = useRef<Group>(null);
  useFrame(() => {
    const group = dimRef.current;
    if (!group) return;
    const lit = fadeValue() > FOREGROUND_OFF;
    if (group.visible !== lit) group.visible = lit;
  });

  const previous = useRef(position);
  const lastHome = useRef(homeToken);
  const [{ ox, oy, oz, arc }, glideApi] = useSpring(() => ({ ox: 0, oy: 0, oz: 0, arc: 1 }), []);
  useLayoutEffect(() => {
    const last = previous.current;
    // A different home is not a move: the pose is taken at once and the change is carried by the
    // same cross-fade reduced motion uses (see `homeToken` in `Furniture`).
    const sameHome = lastHome.current === homeToken;
    lastHome.current = homeToken;
    if (last[0] === position[0] && last[1] === position[1] && last[2] === position[2]) return;
    previous.current = position;
    if (reduced || !sameHome) {
      glideApi.set({ ox: 0, oy: 0, oz: 0, arc: 1 });
      startFade(0.15, 1, CROSSFADE_MS);
      return;
    }
    glideApi.start({
      from: { ox: last[0] - position[0], oy: last[1] - position[1], oz: last[2] - position[2], arc: 0 },
      to: { ox: 0, oy: 0, oz: 0, arc: 1 },
      delay: moveDelay,
      config: motionTokens.spring,
    });
  }, [position, moveDelay, glideApi, reduced, startFade, homeToken]);

  const [{ exit }, exitApi] = useSpring(() => ({ exit: 1, config: { duration: EXIT_MS } }), []);
  useEffect(() => {
    if (!exiting) return;
    // STYLE.md §3: removal is shrink *and* fade — and a fade alone when motion is reduced.
    if (!reduced) exitApi.start({ exit: 0.4 });
    startFade(1, 0, EXIT_MS);
  }, [exiting, exitApi, reduced, startFade]);

  const { hoverY } = useSpring({ hoverY: hovered && !calm ? HOVER_LIFT : 0, config: motionTokens.springSoft });
  const bodyY = to([drop, hoverY, arc], (d, h, a) => d * DROP_HEIGHT + h + ARC_HEIGHT * Math.sin(Math.PI * clamp(a, 0, 1)));
  const bodyScale = to([bounce, exit], (b, e) => b * e);

  return (
    <group name={`item-${item.id}`} position={position} visible={!hidden}>
      <group ref={dimRef}>
        <animated.group position-x={ox} position-y={oy} position-z={oz}>
          <animated.group position-y={bodyY} scale={bodyScale}>
            <group ref={body} rotation-y={rotationRadians(item.rotation)}>
              {/* A resized item is the same model stretched per axis; the shared GLB stays cached. */}
              <group scale={stretch}>
                <ItemBody product={product} colorway={item.colorway} ghost={ghost} recede={recede} framed={framed} />
              </group>
            </group>
          </animated.group>
        </animated.group>
        {selected && !ghost ? <Halo width={footprintM.w} depth={footprintM.d} invalid={invalid} /> : null}
        {dust && !calm ? <DustRing width={footprintM.w} depth={footprintM.d} /> : null}
      </group>
    </group>
  );
}

/** GLB once the asset is available, the procedural placeholder until then. */
function ItemBody({ product, colorway, ghost, recede, framed }: { product: CatalogItem; colorway: string; ghost: boolean; recede: number; framed: boolean }) {
  // A ghost is under someone's pointer, so it is as urgent as the framed room whatever room it is in.
  const state = useGlbState(product.glb, framed || ghost);
  const hex = product.colorways.find((entry) => entry.id === colorway)?.hex ?? product.colorways[0]?.hex ?? palette.oak;
  const fallback = <Placeholder category={product.category} dims={product.dims} colorwayHex={hex} ghost={ghost} recede={recede} />;
  if (state !== "present") return fallback;
  return (
    <GlbBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <GlbBody product={product} hex={hex} ghost={ghost} recede={recede} />
      </Suspense>
    </GlbBoundary>
  );
}

function GlbBody({ product, hex, ghost, recede }: { product: CatalogItem; hex: string; ghost: boolean; recede: number }) {
  const model = useNormalizedGlb(product, hex, ghost, recede);
  return <primitive object={model} />;
}

/** Soft halo on the floor beneath the selected item — ochre normally, rose when it breaks a rule. */
function Halo({ width, depth, invalid = false }: { width: number; depth: number; invalid?: boolean }) {
  const map = useSoftRing();
  const size = Math.max(width, depth) + 0.36;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, SELECTION_HALO_Y, 0]} renderOrder={2}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial
        map={map ?? undefined}
        color={invalid ? palette.rose : palette.ochre}
        transparent
        opacity={0.6}
        depthWrite={false}
        toneMapped={false}
      />
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
 *
 * The trigger is the mutation batch, not `activity[0]`: the store is updated inside the handler and
 * the receipt is written after it returns, so by the time a receipt names `arrange_room` the render
 * that moved everything has already been and gone.
 */
function useMoveChoreography(resolved: Resolved[], reduced: boolean): ReadonlyMap<string, number> {
  const tool = toolBatch();

  const delays = useMemo(() => {
    if (reduced || tool !== CHOREOGRAPHED_TOOL) return noDelays();
    return staggerDelays(resolved.map((entry) => {
      const last = lastPositions.get(entry.item.id);
      return {
        id: entry.item.id,
        distance: last ? Math.hypot(entry.position[0] - last[0], entry.position[2] - last[2]) : 0,
      };
    }));
  }, [resolved, tool, reduced]);

  // Recorded straight after the render that measured against them, which is what keeps the stagger
  // to the one render where the poses actually changed.
  useEffect(() => {
    lastPositions.clear();
    for (const entry of resolved) lastPositions.set(entry.item.id, entry.position);
  }, [resolved]);

  return delays;
}
