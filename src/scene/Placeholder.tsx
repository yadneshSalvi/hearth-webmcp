"use client";
/**
 * Renders the procedural stand-in for a catalog item: soft rounded slabs, hairline-edged casework,
 * timber legs and glowing shades in the item's colorway. Used whenever a GLB is missing or fails.
 */
import { useMemo } from "react";
import { Edges, RoundedBox } from "@react-three/drei";
import type { Category, Dims } from "../engine/types";
import { palette } from "../tokens";
import { M } from "./math";
import { getMaterial, ghostSpec, toneSpec } from "./materials";
import { placeholderParts } from "./parts";
import type { Part } from "./parts";

export interface PlaceholderProps {
  category: Category;
  dims: Dims;
  colorwayHex: string;
  ghost?: boolean;
  castShadow?: boolean;
  /** Blend toward plaster for rooms outside the camera's frame. */
  recede?: number;
}

/** The designed procedural item: one mesh per part, all in palette tones. */
export function Placeholder({ category, dims, colorwayHex, ghost = false, castShadow = true, recede = 0 }: PlaceholderProps) {
  const parts = useMemo(() => placeholderParts(category, dims), [category, dims]);
  return (
    <group name={`placeholder-${category}`}>
      {parts.map((part, index) => (
        <PartMesh key={index} part={part} colorwayHex={colorwayHex} ghost={ghost} castShadow={castShadow} recede={recede} />
      ))}
    </group>
  );
}

interface PartMeshProps {
  part: Part;
  colorwayHex: string;
  ghost: boolean;
  castShadow: boolean;
  recede: number;
}

function PartMesh({ part, colorwayHex, ghost, castShadow, recede }: PartMeshProps) {
  const spec = toneSpec(part.tone, colorwayHex);
  const material = getMaterial(ghost ? ghostSpec(spec) : { ...spec, recede });
  const position: [number, number, number] = [part.pos[0] * M, part.pos[1] * M, part.pos[2] * M];
  const shadow = castShadow && !ghost;

  if (part.shape === "round") {
    const [w, h, d] = part.size as [number, number, number];
    return (
      <RoundedBox
        args={[w * M, h * M, d * M]}
        radius={(part.radius ?? 2) * M}
        smoothness={3}
        creaseAngle={0.5}
        position={position}
        material={material}
        castShadow={shadow}
        receiveShadow
      />
    );
  }
  if (part.shape === "cylinder") {
    const [top, bottom, height] = part.size as [number, number, number];
    return (
      <mesh position={position} material={material} castShadow={shadow} receiveShadow>
        <cylinderGeometry args={[top * M, bottom * M, height * M, 24]} />
      </mesh>
    );
  }
  if (part.shape === "sphere") {
    const [radius] = part.size as [number];
    return (
      <mesh position={position} material={material} castShadow={shadow} receiveShadow>
        <sphereGeometry args={[radius * M, 20, 14]} />
      </mesh>
    );
  }
  const [w, h, d] = part.size as [number, number, number];
  return (
    <mesh position={position} material={material} castShadow={shadow} receiveShadow>
      <boxGeometry args={[w * M, h * M, d * M]} />
      {part.hairline && !ghost ? <Edges threshold={20} color={palette.charcoal} lineWidth={1} transparent opacity={0.16} /> : null}
    </mesh>
  );
}
