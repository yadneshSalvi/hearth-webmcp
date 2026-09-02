"use client";
/**
 * Conflict overlays drawn as blueprint diagrams, never alarms (STYLE.md §3): dashed amber door
 * swings, softly pulsing rose floor zones and a flowing dotted dusty-blue traffic line, plus the
 * 150 cm turning-circle guides that accessibility mode asks for.
 */
import { useEffect, useMemo, useRef } from "react";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSpring } from "@react-spring/three";
import { ShapeGeometry, Shape } from "three";
import type { MeshBasicMaterial } from "three";
import { turningCircleDiameter } from "../engine/clearance";
import { polyBBox } from "../engine/geometry";
import type { Conflict, Room, Vec2 } from "../engine/types";
import { palette } from "../tokens";
import { useReducedMotion, useStudioAwake } from "./idle";
import { M } from "./math";
import { useConflicts, useFurniture, useMeta, useProductLookup, useRooms } from "./useSceneStore";
import { productFor } from "../engine/catalog";

const ZONE_KINDS = new Set(["overlap", "outside", "clearance", "access_path", "turning_circle", "reach"]);
const GUIDE_CATEGORIES = new Set(["sofa", "bed", "desk"]);
/** Diagram heights in metres, all above a 3 cm rug so overlays are never buried. */
const ZONE_Y = 0.042;
const ARC_Y = 0.048;
const TRAFFIC_Y = 0.054;
const GUIDE_Y = 0.05;

interface DashHandle {
  material: { dashOffset: number; opacity: number };
}

/** Every conflict diagram plus the accessibility guides for the active room. */
export function Overlays() {
  const conflicts = useConflicts();
  const rooms = useRooms();
  const meta = useMeta();
  const reduced = useReducedMotion();
  const awake = useStudioAwake();
  const zoneRefs = useRef<(MeshBasicMaterial | null)[]>([]);
  const dashRefs = useRef<(DashHandle | null)[]>([]);

  const { loop } = useSpring({
    from: { loop: 0 },
    to: { loop: 1 },
    loop: true,
    config: { duration: 1600 },
    pause: reduced || !awake,
    immediate: reduced,
  });

  const zones = useMemo(() => buildZones(conflicts, rooms), [conflicts, rooms]);
  const arcs = useMemo(() => buildArcs(conflicts, rooms), [conflicts, rooms]);
  const traffic = useMemo(() => buildTraffic(conflicts, rooms), [conflicts, rooms]);
  useEffect(() => () => zones.forEach((zone) => zone.geometry.dispose()), [zones]);

  useFrame(() => {
    const phase = reduced ? 0.5 : loop.get();
    const pulse = 0.25 + 0.3 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    for (const material of zoneRefs.current) if (material) material.opacity = pulse;
    for (const handle of dashRefs.current) if (handle) handle.material.dashOffset = -phase * 0.36;
  });

  return (
    <group name="overlays">
      {zones.map((zone, index) => (
        <mesh key={zone.key} geometry={zone.geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, ZONE_Y, 0]} renderOrder={3}>
          <meshBasicMaterial
            ref={(node) => void (zoneRefs.current[index] = node)}
            color={palette.rose}
            transparent
            opacity={0.4}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {arcs.map((arc) => (
        <Line
          key={arc.key}
          points={arc.points}
          color={palette.amber}
          lineWidth={2}
          dashed
          dashSize={0.16}
          gapSize={0.1}
          transparent
          opacity={0.6}
          toneMapped={false}
        />
      ))}
      {traffic.map((line, index) => (
        <Line
          key={line.key}
          points={line.points}
          color={palette.dustyBlue}
          lineWidth={3}
          dashed
          dashSize={0.07}
          gapSize={0.11}
          transparent
          opacity={0.85}
          toneMapped={false}
          ref={(node) => void (dashRefs.current[index] = node as unknown as DashHandle | null)}
        />
      ))}
      {meta.accessibilityMode ? <AccessibilityGuides /> : null}
    </group>
  );
}

/** 150 cm turning-circle guides beside every sofa, bed and desk in the active room. */
function AccessibilityGuides() {
  const rooms = useRooms();
  const furniture = useFurniture();
  const meta = useMeta();
  const byId = useProductLookup();
  const circles = useMemo(() => {
    const room = rooms.find((candidate) => candidate.id === meta.activeRoomId);
    if (!room) return [];
    const radius = turningCircleDiameter / 2;
    return furniture
      .filter((item) => item.roomId === room.id && item.status !== "ghost")
      .map((item) => ({ item, product: productFor(item, byId) }))
      .filter((entry) => entry.product && GUIDE_CATEGORIES.has(entry.product.category))
      .map((entry) => {
        const product = entry.product;
        if (!product) return null;
        const offset = product.dims.d / 2 + radius;
        const centre = frontOf(entry.item.pos, entry.item.rotation, offset);
        const points: [number, number, number][] = [];
        for (let step = 0; step <= 48; step += 1) {
          const angle = (step / 48) * Math.PI * 2;
          points.push([
            (room.origin.x + centre.x + Math.cos(angle) * radius) * M,
            GUIDE_Y,
            (room.origin.y + centre.y + Math.sin(angle) * radius) * M,
          ]);
        }
        return { key: `guide-${entry.item.id}`, points };
      })
      .filter((entry): entry is { key: string; points: [number, number, number][] } => entry !== null);
  }, [rooms, furniture, meta.activeRoomId, byId]);
  return (
    <>
      {circles.map((circle) => (
        <Line
          key={circle.key}
          points={circle.points}
          color={palette.dustyBlue}
          lineWidth={1.4}
          dashed
          dashSize={0.14}
          gapSize={0.1}
          transparent
          opacity={0.42}
          toneMapped={false}
        />
      ))}
    </>
  );
}

/** Point `distance` cm in front of an item (rotation 0 faces south). */
function frontOf(pos: Vec2, rotation: number, distance: number): Vec2 {
  const radians = (rotation * Math.PI) / 180;
  return { x: pos.x - Math.sin(radians) * distance, y: pos.y + Math.cos(radians) * distance };
}

function roomOf(rooms: Room[], id: string): Room | undefined {
  return rooms.find((room) => room.id === id);
}

function buildZones(conflicts: Conflict[], rooms: Room[]): { key: string; geometry: ShapeGeometry }[] {
  const result: { key: string; geometry: ShapeGeometry }[] = [];
  conflicts.forEach((conflict, index) => {
    if (!ZONE_KINDS.has(conflict.kind) || !conflict.zone || conflict.zone.length < 3) return;
    const room = roomOf(rooms, conflict.roomId);
    if (!room) return;
    const shape = new Shape();
    conflict.zone.forEach((point, pointIndex) => {
      const x = (room.origin.x + point.x) * M;
      const y = -(room.origin.y + point.y) * M;
      if (pointIndex === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    result.push({ key: `zone-${index}-${conflict.kind}`, geometry: new ShapeGeometry(shape) });
  });
  return result;
}

function buildArcs(conflicts: Conflict[], rooms: Room[]): { key: string; points: [number, number, number][] }[] {
  const result: { key: string; points: [number, number, number][] }[] = [];
  conflicts.forEach((conflict, index) => {
    if (conflict.kind !== "door_swing" || !conflict.zone || conflict.zone.length < 3) return;
    const room = roomOf(rooms, conflict.roomId);
    if (!room) return;
    const points = conflict.zone.map((point): [number, number, number] => [
      (room.origin.x + point.x) * M,
      ARC_Y,
      (room.origin.y + point.y) * M,
    ]);
    result.push({ key: `arc-${index}`, points: [...points, points[0] as [number, number, number]] });
  });
  return result;
}

function buildTraffic(conflicts: Conflict[], rooms: Room[]): { key: string; points: [number, number, number][] }[] {
  const result: { key: string; points: [number, number, number][] }[] = [];
  conflicts.forEach((conflict, index) => {
    if (conflict.kind !== "traffic") return;
    const room = roomOf(rooms, conflict.roomId);
    if (!room) return;
    const zone = conflict.zone ?? [];
    const points =
      zone.length >= 2
        ? zone.map((point): [number, number, number] => [(room.origin.x + point.x) * M, TRAFFIC_Y, (room.origin.y + point.y) * M])
        : centreLine(room);
    result.push({ key: `traffic-${index}`, points });
  });
  return result;
}

function centreLine(room: Room): [number, number, number][] {
  const box = polyBBox(room.poly);
  const midY = (box.minY + box.maxY) / 2;
  return [
    [(room.origin.x + box.minX + 20) * M, TRAFFIC_Y, (room.origin.y + midY) * M],
    [(room.origin.x + box.maxX - 20) * M, TRAFFIC_Y, (room.origin.y + midY) * M],
  ];
}
