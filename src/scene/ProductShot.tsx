"use client";
/**
 * Product shot — one catalog item, rendered through the *real* studio pipeline: the same GLB
 * loader, the same palette re-tint, the same single lighting rig at noon, the same ACES tone
 * mapping. `scripts/assets/thumbs-retint.ts` drives this route and screenshots the stage, so a
 * catalog card and the dollhouse can never disagree about what a product looks like (STYLE.md §2).
 *
 * Dev-only: `app/(dev)/render/page.tsx` returns a 404 in production.
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, addAfterEffect, useThree } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import type { OrthographicCamera as OrthographicCameraImpl } from "three";
import type { CatalogItem, Furniture as FurnitureData, Room, Scene } from "../engine/types";
import type { ColorwayId } from "../tokens";
import { hearthStore, useHearthStore } from "../state/store";
import { palette } from "../tokens";
import { useNormalizedGlb } from "./assets";
import { useGlbState } from "./glb";
import { THUMB_BACKDROP, thumbnailColorway } from "./thumbnail";
import { Furniture } from "./Furniture";
import { LightingRig } from "./LightingRig";
import { boxCentre, cameraOffset, fitHalfHeight, itemBox } from "./math";

/** Thumbnail frame; the catalog renders these 4:3 (`src/ui/CatalogThumb.tsx`). */
export const SHOT_WIDTH = 512;
export const SHOT_HEIGHT = 384;

/** Three-quarter view from the front: rotation 0 faces south, so azimuth 0 looks straight at it. */
const SHOT_AZIMUTH = (-34 * Math.PI) / 180;
const SHOT_PITCH = (21 * Math.PI) / 180;
const SHOT_DISTANCE = 40;
const SHOT_PADDING = 0.1;
/** Backdrop margin around the item, in cm — enough floor for the contact shadow to land on. */
const ROOM_MARGIN = 220;
/** Frames to paint before the stage calls itself ready, so nothing is captured half-drawn. */
const PAINT_FRAMES = 10;

interface Shot {
  product: CatalogItem;
  colorway: ColorwayId;
}

function parseRequest(catalog: CatalogItem[]): Shot | undefined {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const product = catalog.find((candidate) => candidate.id === id) ?? (id ? undefined : catalog[0]);
  if (!product) return undefined;
  const asked = params.get("colorway");
  // With nothing asked for, the shot picks the colourway the catalog should show (src/scene/thumbnail.ts).
  const fallback = product.colorways.find((entry) => entry.id === thumbnailColorway(product))?.id;
  const colorway: ColorwayId = product.colorways.find((entry) => entry.id === asked)?.id
    ?? fallback
    ?? product.colorways[0]?.id
    ?? "oak";
  return { product, colorway };
}

/** A square plaster backdrop with the item alone at its centre, front facing south. */
function shotScene({ product, colorway }: Shot): Scene {
  const size = Math.max(product.dims.w, product.dims.d, product.dims.h) + ROOM_MARGIN * 2;
  const room: Room = {
    id: "shot",
    name: "Product shot",
    type: "studio",
    poly: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }],
    // Origin offset by half the backdrop, so the item lands on the world origin: the camera and the
    // contact shadow can then both be written down as "centred".
    origin: { x: -size / 2, y: -size / 2 },
    floor: "pale-oak",
    wallColor: "plaster",
  };
  const item: FurnitureData = {
    id: `shot-${product.id}`,
    catalogId: product.id,
    roomId: "shot",
    pos: { x: size / 2, y: size / 2 },
    rotation: 0,
    colorway,
    status: "placed",
  };
  return {
    rooms: [room],
    openings: [],
    furniture: [item],
    variants: [],
    meta: {
      mode: "design",
      view: "dollhouse",
      yaw: "sw",
      timeOfDay: "noon",
      paletteId: "warm-clay",
      accessibilityMode: false,
      activeRoomId: "shot",
      selection: {},
      template: "studio",
    },
  };
}

/** Frames the item tightly, three-quarter from the front. Manual: no tween, no zoom, no pan. */
function ShotCamera() {
  const size = useThree((state) => state.size);
  const scene = useHearthStore((state) => state.scene);
  const catalog = useHearthStore((state) => state.catalog);
  const cameraRef = useRef<OrthographicCameraImpl>(null);

  const frame = useMemo(() => {
    const room = scene.rooms[0];
    const item = scene.furniture[0];
    const product = catalog.find((candidate) => candidate.id === item?.catalogId);
    if (!room || !item || !product) return undefined;
    const box = itemBox(room, item, product, 0.1);
    const aspect = size.height > 0 ? size.width / size.height : SHOT_WIDTH / SHOT_HEIGHT;
    return {
      centre: boxCentre(box),
      half: fitHalfHeight(box, SHOT_AZIMUTH, SHOT_PITCH, aspect, SHOT_PADDING),
      aspect,
    };
  }, [scene, catalog, size]);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (!camera || !frame) return;
    const offset = cameraOffset(SHOT_AZIMUTH, SHOT_PITCH);
    const halfWidth = frame.half * frame.aspect;
    camera.position.set(
      frame.centre[0] + offset[0] * SHOT_DISTANCE,
      frame.centre[1] + offset[1] * SHOT_DISTANCE,
      frame.centre[2] + offset[2] * SHOT_DISTANCE,
    );
    camera.rotation.order = "YXZ";
    camera.rotation.set(-SHOT_PITCH, SHOT_AZIMUTH, 0);
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = frame.half;
    camera.bottom = -frame.half;
    camera.updateProjectionMatrix();
  }, [frame]);

  return (
    <OrthographicCamera ref={cameraRef} makeDefault manual near={1} far={SHOT_DISTANCE * 3} left={-1} right={1} top={1} bottom={-1} />
  );
}

/** Fires once the given number of frames have actually been painted. */
function PaintBridge({ frames, onPainted }: { frames: number; onPainted(): void }) {
  useEffect(() => {
    let painted = 0;
    return addAfterEffect(() => {
      painted += 1;
      if (painted === frames) onPainted();
    });
  }, [frames, onPainted]);
  return null;
}

/**
 * Suspends on the very GLB the item renders, so "loaded" means the real model is on screen rather
 * than the procedural stand-in. A product whose asset is missing resolves immediately instead.
 */
function ModelBridge({ product, colorway, onLoaded }: { product: CatalogItem; colorway: string; onLoaded(): void }) {
  const state = useGlbState(product.glb);
  useEffect(() => {
    if (state === "missing") onLoaded();
  }, [state, onLoaded]);
  if (state !== "present") return null;
  return (
    <Suspense fallback={null}>
      <LoadedProbe product={product} colorway={colorway} onLoaded={onLoaded} />
    </Suspense>
  );
}

function LoadedProbe({ product, colorway, onLoaded }: { product: CatalogItem; colorway: string; onLoaded(): void }) {
  const hex = product.colorways.find((entry) => entry.id === colorway)?.hex ?? product.colorways[0]?.hex ?? palette.oak;
  useNormalizedGlb(product, hex);
  useEffect(() => {
    onLoaded();
  }, [onLoaded]);
  return null;
}

export function ProductShot() {
  const catalog = useHearthStore((state) => state.catalog);
  const [shot] = useState(() => parseRequest(catalog));
  const [loaded, setLoaded] = useState(false);
  const [painted, setPainted] = useState(false);
  const onLoaded = useCallback(() => setLoaded(true), []);
  const onPainted = useCallback(() => setPainted(true), []);
  const ready = loaded && painted;

  useEffect(() => {
    if (shot) hearthStore.getState().resetScene(shotScene(shot));
  }, [shot]);

  if (!shot) {
    return (
      <p className="p-6 font-display text-[15px] italic text-ink-muted">
        Pass ?id=&lt;catalogId&gt; — that product is not in the catalog.
      </p>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-start gap-3 p-6" data-render-id={shot.product.id}>
      <div
        id="stage"
        data-render={ready ? "ready" : "painting"}
        style={{ width: SHOT_WIDTH, height: SHOT_HEIGHT, background: THUMB_BACKDROP }}
        className="relative overflow-hidden"
      >
        <Canvas
          orthographic
          shadows="variance"
          dpr={1}
          gl={{
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true,
            toneMapping: ACESFilmicToneMapping,
            outputColorSpace: SRGBColorSpace,
          }}
          style={{ background: "transparent" }}
        >
          <ShotCamera />
          <LightingRig />
          <Backdrop />
          <Furniture />
          <ModelBridge product={shot.product} colorway={shot.colorway} onLoaded={onLoaded} />
          <PaintBridge frames={PAINT_FRAMES} onPainted={onPainted} />
        </Canvas>
      </div>
      <p className="label-caps">
        {shot.product.id} · {shot.colorway}
      </p>
    </div>
  );
}

/**
 * The backdrop is the card's own tile colour: the canvas stays transparent, so a thumbnail sits on
 * the exact same surface as the catalog tile it lands in (`src/ui/CatalogThumb.tsx` matches
 * `THUMB_BACKDROP`), and the item's weight comes from a soft charcoal contact shadow rather than a
 * second, differently lit floor.
 */
function Backdrop() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
      <planeGeometry args={[24, 24]} />
      <shadowMaterial transparent opacity={0.3} color={palette.charcoal} />
    </mesh>
  );
}

export default ProductShot;
