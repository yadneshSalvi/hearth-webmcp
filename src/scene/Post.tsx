"use client";
/**
 * Post chain: N8AO ambient occlusion, restrained bloom on emissives only, a barely-there vignette
 * and ACES filmic tone mapping. Three quality tiers step down under 45 fps and back up above 58,
 * with hysteresis and an idle guard so waking from the demand loop never triggers a downgrade.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PerformanceMonitor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { HalfFloatType } from "three";
import { palette } from "../tokens";
import { useStudioAwake } from "./idle";

/** 0 = low, 1 = medium, 2 = high. */
export type QualityTier = 0 | 1 | 2;

// Occlusion always runs at half resolution with depth-aware upsampling: at 1440×900 dpr 2 a
// full-res AO pass alone costs more than the rest of the frame, and the denoised half-res result
// is visually indistinguishable on matte clay.
const AO = [
  { quality: "performance" as const, aoSamples: 8, denoiseSamples: 2, intensity: 1.7 },
  { quality: "medium" as const, aoSamples: 12, denoiseSamples: 3, intensity: 1.9 },
  { quality: "high" as const, aoSamples: 18, denoiseSamples: 4, intensity: 2.1 },
];

/**
 * Constant: `multisampling` and Bloom `levels` are constructor arguments, so changing them with the
 * quality tier tears down and rebuilds the composer. That stalled a frame by ~150 ms, which made the
 * frame-rate monitor decline again — a feedback loop. Only live props vary with the tier now.
 */
const MULTISAMPLING = 2;
const BLOOM_LEVELS = 7;

/**
 * A pinned tier freezes adaptive quality. The screenshot harness pins the top tier so a busy machine
 * cannot silently capture the beauty set with half the occlusion samples.
 */
let pinnedTier: QualityTier | undefined;
const pinListeners = new Set<() => void>();

/** Pins (or with `undefined` releases) the quality tier. Dev tooling only. */
export function pinQualityTier(tier: QualityTier | undefined): void {
  pinnedTier = tier;
  for (const listener of pinListeners) listener();
}

function subscribePin(listener: () => void): () => void {
  pinListeners.add(listener);
  return () => {
    pinListeners.delete(listener);
  };
}

const TIER_COOLDOWN_MS = 1400;
const WAKE_GRACE_MS = 1600;

/** The studio's post-processing stack plus its adaptive quality governor. */
export function Post() {
  const [tier, setTier] = useState<QualityTier>(2);
  const pinned = useSyncExternalStore(subscribePin, () => pinnedTier, () => undefined);
  const pixels = useThree((state) => state.size.width * state.size.height * state.viewport.dpr ** 2);
  const awake = useStudioAwake();
  const awokeAt = useRef(0);
  const changedAt = useRef(0);

  useEffect(() => {
    if (awake) awokeAt.current = Date.now();
  }, [awake]);

  const step = (direction: -1 | 1) => {
    const now = Date.now();
    if (pinned !== undefined) return;
    if (!awake || now - awokeAt.current < WAKE_GRACE_MS || now - changedAt.current < TIER_COOLDOWN_MS) return;
    setTier((current) => {
      const next = Math.min(2, Math.max(0, current + direction)) as QualityTier;
      if (next !== current) changedAt.current = now;
      return next;
    });
  };

  // Quality is capped by the pixel budget as well as by frame rate: at 1440×900 dpr 2 the top tier
  // costs more in the occlusion pass alone than the whole rest of the frame, and the fps monitor
  // needs a second and a half of dropped frames before it reacts.
  const cap: QualityTier = pixels > 7_000_000 ? 0 : pixels > 3_200_000 ? 1 : 2;
  const effective = (pinned ?? Math.min(tier, cap)) as QualityTier;
  const ao = AO[effective] ?? AO[2];
  return (
    <>
      <PerformanceMonitor
        ms={260}
        iterations={6}
        threshold={0.7}
        flipflops={Infinity}
        bounds={() => [45, 58]}
        onDecline={() => step(-1)}
        onIncline={() => step(1)}
      />
      <EffectComposer frameBufferType={HalfFloatType} multisampling={MULTISAMPLING} enableNormalPass={false}>
        <N8AO
          aoRadius={0.9}
          distanceFalloff={0.9}
          intensity={ao?.intensity ?? 2}
          quality={ao?.quality ?? "high"}
          halfRes
          depthAwareUpsampling
          aoSamples={ao?.aoSamples ?? 18}
          denoiseSamples={ao?.denoiseSamples ?? 4}
          denoiseRadius={12}
          color={palette.charcoal}
          screenSpaceRadius={false}
        />
        <Bloom luminanceThreshold={1.02} luminanceSmoothing={0.28} intensity={effective === 0 ? 0.42 : 0.62} mipmapBlur radius={0.7} levels={BLOOM_LEVELS} />
        <Vignette offset={0.34} darkness={0.3} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}
