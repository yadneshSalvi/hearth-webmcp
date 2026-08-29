"use client";
/**
 * Rooms: procedural floors, outward-extruded walls with cut openings, door leaves, window glass,
 * the camera-facing wall cut-away and the flat plan-view outline with room labels.
 *
 * Walls receive shadows but never cast them — the dollhouse convention. A 2.6 m enclosure under a
 * low golden sun would otherwise leave every interior in its own shade, so the key light floods the
 * rooms and the long soft shadows come from the furniture, which is what the eye reads as light.
 */
import { useEffect, useMemo, useRef } from "react";
import { Html, Line } from "@react-three/drei";
import { animated, useSpring } from "@react-spring/three";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, ShapeGeometry } from "three";
import { roomAreaM2 } from "../engine/geometry";
import { swingZone } from "../engine/doors";
import type { Opening, Room, Vec2 } from "../engine/types";
import { mix, palette, wallColorHex } from "../tokens";
import { DOLLHOUSE_PITCH, DOOR_H, DOOR_LEAF_T, M, PLAN_PITCH, WALL_H, easeOut, wallOpacity, yawAzimuth } from "./math";
import { useOrbitQuantized } from "./cameraState";
import { WALL_HEIGHT_M, WALL_THICKNESS_M, buildRoomWalls, disposeWalls, polygonShape, primaryDoorIds } from "./walls";
import type { Group, Mesh } from "three";
import type { WallBuild } from "./walls";
import { useHoveredRoomId } from "./interactionDrag";
import { useFloorTexture } from "./textures";
import { useFramedBox } from "./framing";
import { useIntroView } from "./intro";
import { useMeta, useOpenings, useRooms } from "./useSceneStore";

const FLOOR_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];
/** The 1 px hairline along a wall's top edge; it stays visible even when the wall is cut away. */
const TOP_EDGE = (length: number, z: number): [number, number, number][] => [
  [0, WALL_HEIGHT_M, z],
  [length, WALL_HEIGHT_M, z],
];
const FADE_TWEEN = { duration: 300, easing: easeOut };
const DEG = Math.PI / 180;
/**
 * How coarsely the free orbit is sampled for the cut-away. The angle a wall fades at is a
 * smoothstep, so 4° is imperceptible in the result — but it turns a 2 s orbit drag from ~120
 * re-renders of every wall in the home into a handful, and each wall's 300 ms fade hides the step.
 */
const WALL_FADE_STEP_DEG = 4;
/** A cut-away wall keeps its baseboard readable so the room's outline never disappears. */
const BASEBOARD_FLOOR = 0.32;

/** Minimal shape of a drei `Line` so its material opacity can be driven per frame. */
interface LineHandle {
  material: { opacity: number };
}

/** Every room in the home: floor, walls, door swings and plan-view labels. */
export function Rooms() {
  const rooms = useRooms();
  const openings = useOpenings();
  const meta = useMeta();
  const framed = useFramedBox();
  // The cut-away is measured against the camera the human is actually looking through: the framed
  // corner plus whatever they have orbited to (src/scene/cameraState.ts).
  const orbit = useOrbitQuantized(WALL_FADE_STEP_DEG);
  const plan = meta.view === "plan" ? 1 : 0;
  const azimuth = plan ? 0 : yawAzimuth(meta.yaw) + orbit.azimuthDeg * DEG;
  const pitch = plan ? PLAN_PITCH : DOLLHOUSE_PITCH + orbit.pitchDeg * DEG;
  const leafIds = useMemo(() => primaryDoorIds(rooms, openings), [rooms, openings]);
  // The opening settle fades the walls up from the plan (src/scene/intro.ts); afterwards the same
  // opacity is driven only by the camera-facing cut-away, on its usual 300 ms tween.
  const intro = useIntroView();
  return (
    <group name="rooms">
      {rooms.map((room) => (
        <RoomView
          key={room.id}
          room={room}
          openings={openings}
          azimuth={azimuth}
          pitch={pitch}
          plan={plan}
          focusCentre={framed.centreCm}
          cutInFront={framed.kind !== "home"}
          leafIds={leafIds}
          introFade={intro.wallFade}
        />
      ))}
    </group>
  );
}

interface RoomViewProps {
  room: Room;
  openings: Opening[];
  azimuth: number;
  pitch: number;
  plan: number;
  focusCentre: Vec2;
  /** false while the whole home is framed: no wall is cut merely for standing in front. */
  cutInFront: boolean;
  leafIds: Set<string>;
  introFade: number;
}

function RoomView({ room, openings, azimuth, pitch, plan, focusCentre, cutInFront, leafIds, introFade }: RoomViewProps) {
  const builds = useMemo(() => buildRoomWalls(room, openings), [room, openings]);
  useEffect(() => () => disposeWalls(builds), [builds]);
  const wallHex = wallColorHex(room.wallColor ?? "plaster");
  return (
    <group name={`room-${room.id}`}>
      <Floor room={room} />
      {builds.map((build) => (
        <WallView
          key={build.id}
          build={build}
          wallHex={wallHex}
          azimuth={azimuth}
          pitch={pitch}
          plan={plan}
          focusCentre={focusCentre}
          cutInFront={cutInFront}
          leafIds={leafIds}
          introFade={introFade}
        />
      ))}
      <SwingArcs room={room} openings={openings} />
      {plan ? <RoomLabel room={room} /> : null}
    </group>
  );
}

/** One room floor: polygon geometry carrying the room's procedural colour map. */
function Floor({ room }: { room: Room }) {
  const geometry = useMemo(() => new ShapeGeometry(polygonShape(room.poly)), [room.poly]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const map = useFloorTexture(room.floor);
  return (
    <mesh
      geometry={geometry}
      rotation={FLOOR_ROTATION}
      position={[room.origin.x * M, 0, room.origin.y * M]}
      receiveShadow
      name={`floor-${room.id}`}
    >
      <meshStandardMaterial map={map ?? undefined} roughness={0.9} metalness={0} />
    </mesh>
  );
}

interface WallViewProps {
  build: WallBuild;
  wallHex: string;
  azimuth: number;
  pitch: number;
  plan: number;
  focusCentre: Vec2;
  cutInFront: boolean;
  leafIds: Set<string>;
  introFade: number;
}

/** One wall: solid, jamb trim, baseboard, glazing and door leaves, all fading as one body. */
function WallView({ build, wallHex, azimuth, pitch, plan, focusCentre, cutInFront, leafIds, introFade }: WallViewProps) {
  const fade = wallOpacity(build.outward, build.samplesCm, focusCentre, azimuth, pitch, { cutInFront });
  const solidTarget = fade * (1 - plan) * introFade;
  const bandTarget = 0.6 * plan * introFade;
  // The opening fade rides the wall's own cut-away tween: one stable config, so react-spring is
  // never restarted by a fresh object on every render.
  const { solid, band } = useSpring({ solid: solidTarget, band: bandTarget, config: FADE_TWEEN });
  const edgeRefs = useRef<(LineHandle | null)[]>([]);
  const bodyRef = useRef<Group>(null);
  const bandRef = useRef<Mesh>(null);
  const edgeGroupRef = useRef<Group>(null);
  // The top-edge hairline fades with its wall: a cut-away wall is read from its baseboard, and
  // floating hairlines over empty space would turn the far rooms into a wireframe thicket.
  // Fully faded pieces are also switched off, which removes ~70 draw calls from a furnished 2BR.
  useFrame(() => {
    const value = solid.get();
    for (const line of edgeRefs.current) if (line) line.material.opacity = value * 0.28;
    const lit = value > 0.01;
    if (bodyRef.current) bodyRef.current.visible = lit;
    if (edgeGroupRef.current) edgeGroupRef.current.visible = lit;
    if (bandRef.current) bandRef.current.visible = band.get() > 0.01;
  });
  const trimHex = mix(wallHex, palette.plaster, 0.55);

  return (
    <group position={build.origin} rotation={[0, build.rotationY, 0]} name={`wall-${build.id}`}>
      <group ref={bodyRef}>
      {build.solid ? (
        <mesh geometry={build.solid} receiveShadow>
          <animated.meshStandardMaterial
            color={wallHex}
            roughness={0.93}
            metalness={0}
            transparent
            opacity={solid}
            depthWrite={solid.to((value) => value > 0.9)}
          />
        </mesh>
      ) : null}
      {build.trim ? (
        <mesh geometry={build.trim} receiveShadow>
          <animated.meshStandardMaterial
            color={trimHex}
            roughness={0.86}
            metalness={0}
            transparent
            opacity={solid}
            depthWrite={solid.to((value) => value > 0.9)}
          />
        </mesh>
      ) : null}
      </group>
      {build.baseboard ? (
        <mesh geometry={build.baseboard} castShadow={false} receiveShadow>
          <animated.meshStandardMaterial
            color={trimHex}
            roughness={0.8}
            metalness={0}
            transparent
            opacity={solid.to((value) => Math.max(value, BASEBOARD_FLOOR * (1 - plan)))}
            depthWrite={solid.to((value) => value > 0.9)}
          />
        </mesh>
      ) : null}
      {build.glass ? (
        <mesh geometry={build.glass}>
          <animated.meshStandardMaterial
            color={mix(palette.plaster, palette.dustyBlue, 0.62)}
            roughness={0.3}
            metalness={0}
            transparent
            side={DoubleSide}
            depthWrite={false}
            opacity={solid.to((value) => value * value * 0.4)}
          />
        </mesh>
      ) : null}
      {build.leaves.filter((leaf) => leafIds.has(leaf.id)).map((leaf) => (
        <group key={leaf.id} position={[leaf.u, 0, -WALL_THICKNESS_M / 2]} rotation={[0, leaf.angle, 0]}>
          <mesh position={[(leaf.direction * leaf.width) / 2, (DOOR_H * M) / 2, 0]}>
            <boxGeometry args={[leaf.width - 0.012, DOOR_H * M - 0.012, DOOR_LEAF_T * M]} />
            <animated.meshStandardMaterial
              color={mix(wallHex, palette.oak, 0.42)}
              roughness={0.72}
              metalness={0}
              transparent
              opacity={solid}
              depthWrite={solid.to((value) => value > 0.9)}
            />
          </mesh>
        </group>
      ))}
      {plan < 0.5 ? (
        <group ref={edgeGroupRef}>
          <Line
            points={TOP_EDGE(build.length, 0)}
            color={palette.charcoal}
            lineWidth={1}
            transparent
            opacity={0.28}
            ref={(node) => void (edgeRefs.current[0] = node as unknown as LineHandle | null)}
          />
          <Line
            points={TOP_EDGE(build.length, -WALL_THICKNESS_M)}
            color={palette.charcoal}
            lineWidth={1}
            transparent
            opacity={0.28}
            ref={(node) => void (edgeRefs.current[1] = node as unknown as LineHandle | null)}
          />
        </group>
      ) : null}
      {build.planBand ? (
        <mesh geometry={build.planBand} ref={bandRef}>
          <animated.meshStandardMaterial color={palette.charcoal} roughness={1} metalness={0} transparent opacity={band} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

/** Faint quarter-arc on the floor for each inward door swing (engine `swingZone`). */
function SwingArcs({ room, openings }: { room: Room; openings: Opening[] }) {
  const arcs = useMemo(() => {
    const result: { id: string; points: [number, number, number][] }[] = [];
    for (const opening of openings) {
      if (opening.roomId !== room.id) continue;
      const zone = swingZone(opening, room);
      if (!zone) continue;
      const points = zone.map((point): [number, number, number] => [
        (room.origin.x + point.x) * M,
        0.009,
        (room.origin.y + point.y) * M,
      ]);
      result.push({ id: opening.id, points: [...points.slice(1), points[0] as [number, number, number]] });
    }
    return result;
  }, [room, openings]);
  return (
    <>
      {arcs.map((arc) => (
        <Line key={arc.id} points={arc.points} color={palette.charcoal} lineWidth={1} transparent opacity={0.18} />
      ))}
    </>
  );
}

/** Plan-view room label: small-caps name plus the Fraunces area in m², lifting on pointer hover. */
function RoomLabel({ room }: { room: Room }) {
  const hovered = useHoveredRoomId() === room.id;
  const centre = useMemo(() => {
    const sum = room.poly.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / room.poly.length, y: sum.y / room.poly.length };
  }, [room.poly]);
  return (
    <Html
      position={[(room.origin.x + centre.x) * M, WALL_H * M * 0.03, (room.origin.y + centre.y) * M]}
      center
      pointerEvents="none"
      zIndexRange={[20, 0]}
    >
      <div
        className="pointer-events-none flex select-none flex-col items-center gap-1 transition-transform duration-[180ms] ease-out-soft"
        style={{ transform: hovered ? "translateY(-7px)" : "none" }}
      >
        <span className="label-caps whitespace-nowrap" style={hovered ? { color: "var(--color-ink)" } : undefined}>
          {room.name}
        </span>
        <span className="numerals text-[13px] text-ink">{roomAreaM2(room).toFixed(1)} m²</span>
      </div>
    </Html>
  );
}
