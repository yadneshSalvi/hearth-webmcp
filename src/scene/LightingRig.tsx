"use client";
/**
 * The only file in the studio that creates lights (STYLE.md §2, §5). One warm directional key with
 * soft shadows sized to the home, a sky/ground hemisphere fill, a baked Lightformer environment and
 * four time-of-day profiles that interpolate over 2 s — including the page background gradient, the
 * bloom threshold and, in plan view, a softened sun.
 *
 * The profiles themselves and both adjustments live in `src/scene/lighting.ts`, where they are pure
 * and unit tested; this file is the wiring.
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
import type { Profile } from "./lighting";
import { mix, motion as motionTokens, palette } from "../tokens";
import { PROFILES, lerpProfile, planSoften } from "./lighting";
import { M, clamp, easeOut, homeBox, stackElevationCm } from "./math";
import { setGlowIntensity } from "./materials";
import { setBloomThreshold } from "./postState";
import { useFurniture, useMeta, useProductLookup, useRooms } from "./useSceneStore";

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

  // The plan-view softening rides the camera's own 600 ms tween, so the shadows shorten as the
  // camera tips over the room rather than snapping the moment the view flips.
  const { planMix } = useSpring({
    planMix: meta.view === "plan" ? 1 : 0,
    config: { duration: motionTokens.cameraTweenMs, easing: easeOut },
  });

  useFrame((state) => {
    const hour = lerpProfile(fromRef.current, target, clamp(blend.get(), 0, 1));
    currentRef.current = hour;
    const profile = planSoften(hour, clamp(planMix.get(), 0, 1));
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
    setBloomThreshold(profile.bloom);
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
