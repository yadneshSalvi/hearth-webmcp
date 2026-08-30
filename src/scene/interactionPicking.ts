"use client";
/**
 * Screen → scene. Turns client pixels into the two facts a gesture needs: the point under the
 * pointer on a horizontal plane (in world centimetres), and the placed item under the pointer.
 *
 * Both are done with an explicit raycast rather than R3F's per-mesh handlers: a drag has to keep
 * tracking the floor after the pointer leaves the item it grabbed, and a cut-away wall must never
 * swallow a click on the furniture behind it (only the furniture layer is picked).
 */
import { useCallback, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Object3D } from "three";
import type { Furniture, Vec2 } from "../engine/types";
import { hearthStore } from "../state/store";
import { threeToWorldCm } from "./interactionMath";

/** True when nothing between `node` and `root` (inclusive of node) has been switched off. */
function visibleInTree(node: Object3D, root: Object3D): boolean {
  for (let current: Object3D | null = node; current; current = current.parent) {
    if (!current.visible) return false;
    if (current === root) break;
  }
  return true;
}

export interface Picking {
  /** The point under a client position on the horizontal plane at `planeY` metres, world cm. */
  floorAt: (clientX: number, clientY: number, planeY?: number) => Vec2 | undefined;
  /** The placed item under a client position, or undefined. */
  itemAt: (clientX: number, clientY: number) => Furniture | undefined;
}

/** Raycast helpers bound to the live camera and canvas. */
export function usePicking(): Picking {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const threeScene = useThree((state) => state.scene);

  const raycaster = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new Vector3(), []);

  /** Aims the raycaster through a client position; false when the canvas has no size yet. */
  const aim = useCallback(
    (clientX: number, clientY: number): boolean => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return true;
    },
    [camera, gl, ndc, raycaster],
  );

  const floorAt = useCallback(
    (clientX: number, clientY: number, planeY = 0): Vec2 | undefined => {
      if (!aim(clientX, clientY)) return undefined;
      plane.constant = -planeY;
      const point = raycaster.ray.intersectPlane(plane, hit);
      return point ? threeToWorldCm({ x: point.x, z: point.z }) : undefined;
    },
    [aim, hit, plane, raycaster],
  );

  const itemAt = useCallback(
    (clientX: number, clientY: number): Furniture | undefined => {
      const group = threeScene.getObjectByName("furniture");
      if (!group || !aim(clientX, clientY)) return undefined;
      // `frameloop="demand"` only refreshes world matrices when a frame renders, and a pointer can
      // arrive before the first frame after a mount. Picking must never raycast stale transforms.
      group.updateWorldMatrix(false, true);
      const furniture = hearthStore.getState().scene.furniture;
      for (const intersection of raycaster.intersectObject(group, true)) {
        // three's raycaster ignores `visible`, so a piece the renderer has switched off — the item in
        // hand, or a neighbour faded out of the way of the framed room (src/scene/Furniture.tsx) —
        // would still swallow the click that was meant for what is actually on screen.
        if (!visibleInTree(intersection.object, group)) continue;
        for (let node = intersection.object; node; node = node.parent as typeof node) {
          if (!node.name.startsWith("item-")) continue;
          const found = furniture.find((entry) => entry.id === node.name.slice(5));
          return found?.status === "placed" ? found : undefined;
        }
      }
      return undefined;
    },
    [aim, raycaster, threeScene],
  );

  return { floorAt, itemAt };
}
