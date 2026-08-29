"use client";
/**
 * The only file in the studio that creates lights (STYLE.md §2, §5). One warm directional key with
 * soft shadows sized to the home, a sky/ground hemisphere fill, a baked Lightformer environment and
 * four time-of-day profiles that interpolate over 2 s — including the page background gradient.
 *
 * Sun elevations are stylised, not astronomical: a physically low golden sun leaves an interior
 * floor at a fifth of noon's illumination, so each profile trades a little elevation for enough key
 * to keep the floor readable while still throwing shadows two to three times an object's height.
 *
 * Softness comes from variance (VSM) shadow maps rather than drei's `SoftShadows`: that helper
 * patches three's shadow chunk with `unpackRGBAToDepth`, which three 0.185 removed, and the patch
 * breaks every MeshStandardMaterial shader.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSpring } from "@react-spring/three";
import type { DirectionalLight, HemisphereLight, PointLight } from "three";
import type { TimeOfDay } from "../engine/types";
import { mix, motion as motionTokens, palette } from "../tokens";
import { M, clamp, easeOut, homeBox, stackElevationCm } from "./math";
import { lampEmissiveIntensity } from "./retint";
import { setGlowIntensity } from "./materials";
import { useFurniture, useMeta, useProductLookup, useRooms } from "./useSceneStore";

interface Profile {
  /** Sun compass azimuth in degrees: 0 = south, 90 = east, 180 = north, 270 = west. */
  azimuth: number;
  /** Sun elevation above the horizon in degrees. */
  elevation: number;
  keyHex: string;
  keyIntensity: number;
  skyHex: string;
  groundHex: string;
  fillIntensity: number;
  envIntensity: number;
  glow: number;
  bgTop: string;
  bgBottom: string;
}

const PROFILES: Record<TimeOfDay, Profile> = {
  morning: {
    azimuth: 82,
    elevation: 26,
    keyHex: mix(palette.plaster, palette.dustyBlue, 0.16),
    keyIntensity: 3.9,
    skyHex: mix(palette.canvasTop, palette.dustyBlue, 0.3),
    groundHex: mix(palette.oak, palette.plaster, 0.4),
    fillIntensity: 0.95,
    envIntensity: 0.38,
    glow: lampEmissiveIntensity("morning"),
    bgTop: mix(palette.canvasTop, palette.dustyBlue, 0.07),
    bgBottom: mix(palette.canvasBottom, palette.dustyBlue, 0.11),
  },
  noon: {
    azimuth: 8,
    elevation: 62,
    keyHex: mix(palette.plaster, palette.ochre, 0.08),
    keyIntensity: 2.95,
    skyHex: mix(palette.canvasTop, palette.plaster, 0.3),
    groundHex: mix(palette.oak, palette.plaster, 0.35),
    fillIntensity: 0.95,
    envIntensity: 0.4,
    glow: lampEmissiveIntensity("noon"),
    bgTop: palette.canvasTop,
    bgBottom: palette.canvasBottom,
  },
  golden: {
    azimuth: 288,
    elevation: 21,
    keyHex: mix(palette.ochre, palette.terracotta, 0.3),
    keyIntensity: 5.4,
    skyHex: mix(palette.canvasTop, palette.ochre, 0.24),
    groundHex: mix(palette.oak, palette.terracotta, 0.18),
    fillIntensity: 1.0,
    envIntensity: 0.38,
    glow: lampEmissiveIntensity("golden"),
    bgTop: mix(palette.canvasTop, palette.ochre, 0.11),
    bgBottom: mix(palette.canvasBottom, palette.terracotta, 0.12),
  },
  evening: {
    azimuth: 302,
    elevation: 13,
    keyHex: mix(palette.dustyBlue, palette.plum, 0.3),
    keyIntensity: 2.2,
    skyHex: mix(palette.dustyBlue, palette.plum, 0.42),
    groundHex: mix(palette.oak, palette.terracotta, 0.34),
    fillIntensity: 0.72,
    envIntensity: 0.24,
    glow: lampEmissiveIntensity("evening"),
    bgTop: mix(palette.canvasTop, palette.plum, 0.2),
    bgBottom: mix(palette.canvasBottom, palette.terracotta, 0.16),
  },
};

const NUMERIC = ["azimuth", "elevation", "keyIntensity", "fillIntensity", "envIntensity", "glow"] as const;
const COLOURS = ["keyHex", "skyHex", "groundHex", "bgTop", "bgBottom"] as const;

function lerpProfile(from: Profile, to: Profile, t: number): Profile {
  const result = { ...to } as Profile;
  for (const key of NUMERIC) result[key] = from[key] + (to[key] - from[key]) * t;
  for (const key of COLOURS) result[key] = mix(from[key], to[key], t);
  return result;
}

/** The whole lighting rig, including the shadow-map framing and the CSS background gradient. */
export function LightingRig() {
  const rooms = useRooms();
  const meta = useMeta();
  const keyRef = useRef<DirectionalLight>(null);
  const fillRef = useRef<HemisphereLight>(null);
  const target = PROFILES[meta.timeOfDay];
  const fromRef = useRef<Profile>(target);
  const currentRef = useRef<Profile>(target);
  const cssRef = useRef({ top: "", bottom: "" });
  const lampRefs = useRef<(PointLight | null)[]>([]);

  const frame = useMemo(() => {
    const box = homeBox(rooms);
    const centre: [number, number, number] = [
      (box.min[0] + box.max[0]) / 2,
      0,
      (box.min[2] + box.max[2]) / 2,
    ];
    // A bounding sphere for the whole home; VSM shadow precision depends on a tight near/far,
    // so the key light sits just outside it rather than far away.
    const radius = Math.hypot(box.max[0] - box.min[0], box.max[2] - box.min[2], box.max[1]) / 2 + 0.8;
    return { centre, radius, distance: radius * 2 + 3 };
  }, [rooms]);

  const [{ blend }, blendApi] = useSpring(() => ({ blend: 1, config: { duration: motionTokens.timeOfDayMs, easing: easeOut } }), []);
  useLayoutEffect(() => {
    fromRef.current = currentRef.current;
    blendApi.start({ from: { blend: 0 }, to: { blend: 1 } });
  }, [meta.timeOfDay, blendApi]);

  useFrame((state) => {
    const profile = lerpProfile(fromRef.current, target, clamp(blend.get(), 0, 1));
    currentRef.current = profile;
    const azimuth = (profile.azimuth * Math.PI) / 180;
    const elevation = (profile.elevation * Math.PI) / 180;
    const key = keyRef.current;
    if (key) {
      key.position.set(
        frame.centre[0] + Math.cos(elevation) * Math.sin(azimuth) * frame.distance,
        Math.sin(elevation) * frame.distance,
        frame.centre[2] + Math.cos(elevation) * Math.cos(azimuth) * frame.distance,
      );
      key.target.position.set(frame.centre[0], 0, frame.centre[2]);
      key.target.updateMatrixWorld();
      key.color.set(profile.keyHex);
      key.intensity = profile.keyIntensity;
    }
    const fill = fillRef.current;
    if (fill) {
      fill.color.set(profile.skyHex);
      fill.groundColor.set(profile.groundHex);
      fill.intensity = profile.fillIntensity;
    }
    state.scene.environmentIntensity = profile.envIntensity;
    setGlowIntensity(profile.glow);
    for (const lamp of lampRefs.current) if (lamp) lamp.intensity = profile.glow * (typeof lamp.userData.gain === "number" ? lamp.userData.gain : 1);
    if (typeof document !== "undefined" && (cssRef.current.top !== profile.bgTop || cssRef.current.bottom !== profile.bgBottom)) {
      cssRef.current = { top: profile.bgTop, bottom: profile.bgBottom };
      document.documentElement.style.setProperty("--studio-bg-top", profile.bgTop);
      document.documentElement.style.setProperty("--studio-bg-bottom", profile.bgBottom);
    }
  });

  // A low golden/evening sun throws shadows several times the home's width, so the shadow
  // camera is deliberately generous; 2048² over ~34 m still resolves ~1.7 cm per texel.
  const shadowExtent = frame.radius * 2.1;
  return (
    <>
      <hemisphereLight ref={fillRef} intensity={target.fillIntensity} color={target.skyHex} groundColor={target.groundHex} />
      <directionalLight
        ref={keyRef}
        castShadow
        intensity={target.keyIntensity}
        color={target.keyHex}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-radius={2.6}
        shadow-blurSamples={16}
        shadow-bias={0}
        shadow-normalBias={0.012}
        shadow-camera-near={Math.max(0.4, frame.distance - frame.radius * 1.1)}
        shadow-camera-far={frame.distance + frame.radius * 1.1}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
      />
      <LampLights refs={lampRefs} />
      <StudioEnvironment />
    </>
  );
}

/**
 * One warm point light per lamp in the home, driven by the same time-of-day glow as the shades'
 * emissive: invisible by day, a pool of ochre light at dusk. They live here because STYLE.md §5
 * allows lights in this file only.
 */
function LampLights({ refs }: { refs: RefObject<(PointLight | null)[]> }) {
  const furniture = useFurniture();
  const rooms = useRooms();
  const byId = useProductLookup();
  const lamps = useMemo(() => {
    const list: { id: string; position: [number, number, number]; gain: number }[] = [];
    for (const item of furniture) {
      if (item.status === "ghost") continue;
      const product = byId(item.catalogId);
      const room = rooms.find((candidate) => candidate.id === item.roomId);
      if (!product || !room) continue;
      if (product.category !== "floor-lamp" && product.category !== "table-lamp") continue;
      const elevation = stackElevationCm(item, product, { furniture }, byId);
      list.push({
        id: item.id,
        position: [
          (room.origin.x + item.pos.x) * M,
          (elevation + product.dims.h * 0.86) * M,
          (room.origin.y + item.pos.y) * M,
        ],
        gain: product.category === "floor-lamp" ? 2.2 : 1.0,
      });
    }
    return list;
  }, [furniture, rooms, byId]);
  return (
    <>
      {lamps.map((lamp, index) => (
        <pointLight
          key={lamp.id}
          ref={(node) => void (refs.current[index] = node)}
          position={lamp.position}
          color={palette.ochre}
          intensity={0}
          distance={lamp.gain > 1.5 ? 4 : 2.6}
          decay={2}
          userData={{ gain: lamp.gain }}
        />
      ))}
    </>
  );
}

/** A baked Lightformer studio: no HDRI file, no network request, low intensity. */
function StudioEnvironment() {
  return (
    <Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={1.5} color={mix(palette.plaster, palette.canvasTop, 0.5)} scale={[14, 14, 1]} position={[0, 9, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <Lightformer form="rect" intensity={0.85} color={mix(palette.plaster, palette.ochre, 0.3)} scale={[12, 7, 1]} position={[9, 3.5, 0]} rotation={[0, -Math.PI / 2, 0]} />
      <Lightformer form="rect" intensity={0.6} color={mix(palette.plaster, palette.dustyBlue, 0.3)} scale={[12, 7, 1]} position={[-9, 3.5, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Lightformer form="rect" intensity={0.45} color={mix(palette.oak, palette.plaster, 0.4)} scale={[14, 14, 1]} position={[0, -3, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <Lightformer form="circle" intensity={0.5} color={mix(palette.plaster, palette.terracotta, 0.22)} scale={[6, 6, 1]} position={[0, 3, -10]} rotation={[0, 0, 0]} />
    </Environment>
  );
}
