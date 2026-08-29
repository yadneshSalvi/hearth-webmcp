"use client";
/**
 * The agent orb: a small warm emissive sphere that bobs in the active room's south-east corner and
 * flies to the site of every tool action with a glass label chip (STYLE.md §3). Under
 * `prefers-reduced-motion` the orb stays — parked at its idle corner, no bob and no flight — because
 * STYLE.md §3 asks for "orb static", not for the agent's presence to disappear. The chip still
 * appears, so a tool action is still announced.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { animated, useSpring } from "@react-spring/three";
import type { Group } from "three";
import { polyBBox } from "../engine/geometry";
import { motion as motionTokens, palette } from "../tokens";
import { useReducedMotion, useStudioAwake } from "./idle";
import { M } from "./math";
import { useOrbCommand } from "./orbCommand";
import { useActiveRoom, useRooms } from "./useSceneStore";

const IDLE_HEIGHT = 90;
const VISIT_HEIGHT = 60;
const CHIP_MS = 1800;
const RETURN_MS = 4000;
const RADIUS = 6;

/** The orb, its bob, its flight spring and its label chip. */
export function Orb() {
  const rooms = useRooms();
  const activeRoom = useActiveRoom();
  const command = useOrbCommand();
  const reduced = useReducedMotion();
  const awake = useStudioAwake();
  const bobRef = useRef<Group>(null);
  const phase = useRef(0);
  const [expired, setExpired] = useState({ chip: 0, visit: 0 });

  const home = useMemo((): [number, number, number] => {
    if (!activeRoom) return [0, IDLE_HEIGHT * M, 0];
    const box = polyBBox(activeRoom.poly);
    return [
      (activeRoom.origin.x + box.maxX - 45) * M,
      IDLE_HEIGHT * M,
      (activeRoom.origin.y + box.maxY - 45) * M,
    ];
  }, [activeRoom]);

  const destination = useMemo((): [number, number, number] | undefined => {
    if (!command) return undefined;
    const room = rooms.find((candidate) => candidate.id === command.roomId);
    if (!room) return undefined;
    return [(room.origin.x + command.pos.x) * M, VISIT_HEIGHT * M, (room.origin.y + command.pos.y) * M];
  }, [command, rooms]);

  // The chip and the visit expire on timers; the render stays pure by comparing the command id
  // against the ids those timers have already retired.
  const issued = command?.issued ?? 0;
  useEffect(() => {
    if (!issued) return;
    const chipTimer = setTimeout(() => setExpired((current) => ({ ...current, chip: issued })), CHIP_MS);
    const returnTimer = setTimeout(() => setExpired((current) => ({ ...current, visit: issued })), RETURN_MS);
    return () => {
      clearTimeout(chipTimer);
      clearTimeout(returnTimer);
    };
  }, [issued]);
  const chip = command && expired.chip !== issued ? command.label : undefined;
  const visiting = issued !== 0 && expired.visit !== issued;

  const goal = !reduced && visiting && destination ? destination : home;
  const { x, y, z } = useSpring({
    x: goal[0],
    y: goal[1],
    z: goal[2],
    immediate: reduced,
    config: { duration: motionTokens.orbFlightMs, easing: (t: number) => 1 - (1 - t) ** 3 },
  });

  useFrame((_, delta) => {
    if (reduced || !awake) return;
    phase.current += delta;
    if (bobRef.current) bobRef.current.position.y = Math.sin(phase.current * 1.35) * 0.035;
  });

  return (
    <animated.group name="orb" position-x={x} position-y={y} position-z={z}>
      <group ref={bobRef}>
        <mesh castShadow={false}>
          <sphereGeometry args={[RADIUS * M, 28, 20]} />
          <meshStandardMaterial
            color={palette.terracotta}
            emissive={palette.terracotta}
            emissiveIntensity={5.2}
            roughness={0.35}
            metalness={0}
          />
        </mesh>
        {chip ? (
          <Html position={[0, RADIUS * M + 0.3, 0]} center pointerEvents="none" zIndexRange={[40, 20]}>
            <div className="glass pointer-events-none select-none px-3 py-1.5 whitespace-nowrap">
              <span className="font-display text-[13px] text-ink">{chip}</span>
            </div>
          </Html>
        ) : null}
      </group>
    </animated.group>
  );
}
