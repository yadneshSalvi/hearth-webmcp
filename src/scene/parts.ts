/**
 * Procedural furniture parts. When a GLB is missing (or fails) the item still has to look
 * *designed*, so each category is modelled from soft slabs, timber legs and glowing shades in the
 * item's colorway — never a grey box (STYLE.md §2).
 */
import type { Category, Dims } from "../engine/types";
import type { Tone } from "./materials";

export type PartShape = "round" | "box" | "cylinder" | "sphere";

export interface Part {
  shape: PartShape;
  /** Box/round: [w, h, d]. Cylinder: [radiusTop, radiusBottom, height]. Sphere: [radius]. */
  size: number[];
  /** Centre in item-local centimetres; y from the floor, −z is the item's front. */
  pos: [number, number, number];
  tone: Tone;
  /** Rounded-box corner radius in centimetres (default 2, always clamped to fit). */
  radius?: number;
  /** Draw a 1 px hairline along the part's edges (rectilinear casework). */
  hairline?: boolean;
}

const clampRadius = (size: number[], wanted: number): number =>
  Math.max(0.15, Math.min(wanted, Math.min(size[0] as number, size[1] as number, size[2] as number) / 2 - 0.05));

function round(size: [number, number, number], pos: [number, number, number], tone: Tone, radius = 2): Part {
  return { shape: "round", size, pos, tone, radius: clampRadius(size, radius) };
}

function box(size: [number, number, number], pos: [number, number, number], tone: Tone, hairline = false): Part {
  return { shape: "box", size, pos, tone, hairline };
}

function cylinder(radiusTop: number, radiusBottom: number, height: number, pos: [number, number, number], tone: Tone): Part {
  return { shape: "cylinder", size: [radiusTop, radiusBottom, height], pos, tone };
}

function sphere(radius: number, pos: [number, number, number], tone: Tone): Part {
  return { shape: "sphere", size: [radius], pos, tone };
}

function legs(width: number, depth: number, height: number, thickness: number, tone: Tone, inset = 5): Part[] {
  const x = width / 2 - inset - thickness / 2;
  const z = depth / 2 - inset - thickness / 2;
  return [
    [x, z],
    [-x, z],
    [x, -z],
    [-x, -z],
  ].map(([px, pz]) => box([thickness, height, thickness], [px as number, height / 2, pz as number], tone));
}

function seating(dims: Dims, cushions: number): Part[] {
  const { w, d, h } = dims;
  const backT = Math.max(10, d * 0.16);
  const armW = Math.min(17, Math.max(11, w * 0.11));
  const seatTop = Math.max(38, h * 0.5);
  const armTop = Math.max(seatTop + 14, h * 0.74);
  const plinth = 11;
  const parts: Part[] = [
    round([w - 8, plinth, d - 8], [0, plinth / 2, 0], "timber", 1.5),
    round([w, h - plinth, backT], [0, plinth + (h - plinth) / 2, d / 2 - backT / 2], "primary"),
    round([armW, armTop - plinth, d - backT], [w / 2 - armW / 2, plinth + (armTop - plinth) / 2, -backT / 2], "primary"),
    round([armW, armTop - plinth, d - backT], [-(w / 2 - armW / 2), plinth + (armTop - plinth) / 2, -backT / 2], "primary"),
  ];
  const cushionW = (w - armW * 2 - 4 - (cushions - 1) * 3) / cushions;
  const cushionD = d - backT - 8;
  for (let index = 0; index < cushions; index += 1) {
    const offset = -(w - armW * 2 - 4) / 2 + cushionW / 2 + index * (cushionW + 3);
    parts.push(round([cushionW, seatTop - plinth - 2, cushionD], [offset, plinth + (seatTop - plinth - 2) / 2 + 1, -backT / 2 - 2], "light", 3));
    parts.push(round([cushionW - 6, 13, backT * 0.72], [offset, seatTop + 17, d / 2 - backT - 2], "light", 3));
  }
  return parts;
}

function bed(dims: Dims): Part[] {
  const { w, d, h } = dims;
  const lift = 9;
  const frame = 20;
  const mattressH = 20;
  const deck = lift + frame;
  const headboard = Math.max(34, h - deck);
  const pillowD = 32;
  return [
    ...legs(w, d, lift, 6, "shade", 8),
    round([w - 8, frame, d - 8], [0, lift + frame / 2, 0], "timber", 1.5),
    round([w, mattressH, d - 14], [0, deck + mattressH / 2, -6], "light", 4),
    // Duvet over the lower two thirds, pillows against the headboard, so the bed reads at a glance.
    round([w + 3, 8, d * 0.56], [0, deck + mattressH + 1, -(d / 2 - d * 0.3)], "shade", 3),
    round([w / 2 - 9, 13, pillowD], [-(w / 4 + 1), deck + mattressH + 7, d / 2 - 10 - pillowD / 2], "linen", 5),
    round([w / 2 - 9, 13, pillowD], [w / 4 + 1, deck + mattressH + 7, d / 2 - 10 - pillowD / 2], "linen", 5),
    round([w, headboard, 8], [0, deck + headboard / 2, d / 2 - 4], "primary", 2),
  ];
}

function casework(dims: Dims, doors: number, shelves: number): Part[] {
  const { w, d, h } = dims;
  const plinth = 6;
  const bodyH = h - plinth;
  const parts: Part[] = [
    box([w - 5, plinth, d - 4], [0, plinth / 2, 0], "timber"),
    box([w, bodyH, d], [0, plinth + bodyH / 2, 0], "primary", true),
  ];
  const faceW = (w - 4 - (doors - 1) * 1.6) / doors;
  for (let index = 0; index < doors; index += 1) {
    const offset = -(w - 4) / 2 + faceW / 2 + index * (faceW + 1.6);
    parts.push(box([faceW, bodyH - 5, 1.6], [offset, plinth + bodyH / 2, -(d / 2 + 0.8)], "light", true));
    parts.push(cylinder(0.9, 0.9, 9, [offset + faceW / 2 - 4, plinth + bodyH * 0.55, -(d / 2 + 2.4)], "metal"));
  }
  for (let index = 1; index <= shelves; index += 1) {
    parts.push(box([w - 5, 2.2, d - 2], [0, plinth + (bodyH * index) / (shelves + 1), 0.5], "light"));
  }
  return parts;
}

function openShelf(dims: Dims): Part[] {
  const { w, d, h } = dims;
  const panel = 2.6;
  const parts: Part[] = [
    box([panel, h, d], [w / 2 - panel / 2, h / 2, 0], "primary", true),
    box([panel, h, d], [-(w / 2 - panel / 2), h / 2, 0], "primary", true),
    box([w, panel, d], [0, h - panel / 2, 0], "primary", true),
    box([w - panel * 2, 1, d - 2], [0, h * 0.5, d / 2 - 1], "linen"),
  ];
  const bays = 4;
  for (let index = 0; index <= bays; index += 1) {
    parts.push(box([w - panel * 2, 2.2, d], [0, Math.max(1.1, (h - panel) * (index / bays)), 0], "light", true));
  }
  return parts;
}

function surface(dims: Dims, tone: Tone, legThickness: number): Part[] {
  const { w, d, h } = dims;
  const topH = Math.min(4.5, h * 0.07);
  const roundTop = Math.abs(w - d) < 8;
  const top: Part = roundTop
    ? cylinder(w / 2, w / 2, topH, [0, h - topH / 2, 0], tone)
    : round([w, topH, d], [0, h - topH / 2, 0], tone, 1.4);
  return [top, ...legs(w, d, h - topH, legThickness, "shade", roundTop ? w * 0.22 : 6)];
}

function chair(dims: Dims): Part[] {
  const { w, d, h } = dims;
  const seatTop = Math.min(46, h * 0.56);
  return [
    round([w, 4, d * 0.94], [0, seatTop - 2, 0], "primary", 1.6),
    round([w - 4, h - seatTop - 1, 3.6], [0, seatTop + (h - seatTop) / 2, d / 2 - 2.4], "primary", 1.6),
    ...legs(w, d, seatTop - 4, 3, "timber", 3),
  ];
}

function rug(dims: Dims): Part[] {
  const { w, d, h } = dims;
  const thickness = Math.max(1.2, h);
  return [
    round([w, thickness, d], [0, thickness / 2, 0], "light", 0.5),
    round([w - 28, 0.5, d - 28], [0, thickness + 0.15, 0], "linen", 0.2),
  ];
}

function lamp(dims: Dims, shadeH: number, poleR: number): Part[] {
  const { w, h } = dims;
  const baseH = Math.max(1.8, h * 0.02);
  const baseR = (w / 2) * 0.55;
  return [
    cylinder(baseR, baseR * 1.15, baseH, [0, baseH / 2, 0], "metal"),
    cylinder(poleR, poleR, h - baseH - shadeH, [0, baseH + (h - baseH - shadeH) / 2, 0], "metal"),
    cylinder((w / 2) * 0.62, w / 2, shadeH, [0, h - shadeH / 2, 0], "glow"),
  ];
}

function plant(dims: Dims): Part[] {
  const { w, h } = dims;
  const potH = h * 0.3;
  const leafR = w * 0.3;
  return [
    cylinder((w / 2) * 0.88, (w / 2) * 0.6, potH, [0, potH / 2, 0], "primary"),
    cylinder(1.1, 1.4, h * 0.34, [0, potH + h * 0.17, 0], "timber"),
    sphere(leafR, [0, h - leafR * 0.9, 0], "foliage"),
    sphere(leafR * 0.78, [-w * 0.26, h - leafR * 1.5, w * 0.1], "foliage"),
    sphere(leafR * 0.7, [w * 0.24, h - leafR * 1.8, -w * 0.12], "foliage"),
  ];
}

function decor(dims: Dims): Part[] {
  const { w, d, h } = dims;
  if (h < 14) {
    return [
      cylinder(w / 2, (w / 2) * 0.8, h, [0, h / 2, 0], "primary"),
      cylinder((w / 2) * 0.82, (w / 2) * 0.82, h * 0.2, [0, h * 0.92, 0], "linen"),
    ];
  }
  const bodyH = h * 0.74;
  return [
    cylinder((w / 2) * 0.9, (w / 2) * 0.55, bodyH, [0, bodyH / 2, 0], "primary"),
    cylinder((w / 2) * 0.42, (w / 2) * 0.62, h - bodyH, [0, bodyH + (h - bodyH) / 2, 0], "linen"),
    round([w * 0.1, h * 0.1, d * 0.1], [0, h, 0], "linen", 0.4),
  ];
}

/** The designed procedural stand-in for one catalog category at its exact cm dimensions. */
export function placeholderParts(category: Category, dims: Dims): Part[] {
  switch (category) {
    case "sofa":
      return seating(dims, dims.w >= 230 ? 3 : 2);
    case "armchair":
      return seating(dims, 1);
    case "bed":
      return bed(dims);
    case "wardrobe":
      return casework(dims, dims.w >= 140 ? 2 : 1, 0);
    case "tv-unit":
      return casework(dims, 2, 0);
    case "shelf":
      return openShelf(dims);
    case "table":
      return surface(dims, "timber", 5.5);
    case "desk":
      return [
        ...surface(dims, "timber", 4.5),
        box([dims.w * 0.34, dims.h * 0.26, dims.d - 9], [dims.w * 0.28, dims.h * 0.62, 1], "primary", true),
      ];
    case "chair":
      return chair(dims);
    case "rug":
      return rug(dims);
    case "floor-lamp":
      return lamp(dims, 27, 1.5);
    case "table-lamp":
      return lamp(dims, Math.max(12, dims.h * 0.42), 1.1);
    case "plant":
      return plant(dims);
    case "decor":
      return decor(dims);
  }
}
