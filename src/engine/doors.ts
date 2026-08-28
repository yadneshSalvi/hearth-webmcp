import { resolveWall } from "./geometry";
import type { Opening, Room, Scene, Vec2, Wall } from "./types";

/** Resolves an opening to its wall segment; throws when the stored wall id is invalid. */
export function openingSegment(opening: Opening, room: Room): { a: Vec2; b: Vec2; wall: Wall } {
  const wall = resolveWall(room, opening.wallId);
  if (!wall) throw new Error(`Opening ${opening.id} refers to unknown wall ${opening.wallId}`);
  const dx = (wall.b.x - wall.a.x) / wall.length;
  const dy = (wall.b.y - wall.a.y) / wall.length;
  return {
    a: { x: wall.a.x + dx * opening.offset, y: wall.a.y + dy * opening.offset },
    b: { x: wall.a.x + dx * (opening.offset + opening.width), y: wall.a.y + dy * (opening.offset + opening.width) },
    wall,
  };
}

/** Returns openings hosted by one room wall, ordered by clockwise offset. */
export function openingsOnWall(scene: Scene, roomId: string, wallId: string): Opening[] {
  return scene.openings
    .filter((opening) => opening.roomId === roomId && opening.wallId.toLowerCase() === wallId.toLowerCase())
    .sort((a, b) => a.offset - b.offset);
}

/** Returns an eight-segment inward door-swing sector, or null when no inward swing applies. */
export function swingZone(opening: Opening, room: Room): Vec2[] | null {
  if (opening.kind !== "door" || opening.swing !== "in") return null;
  const { a, b, wall } = openingSegment(opening, room);
  const hinge = opening.hinge === "right" ? b : a;
  const dx = (wall.b.x - wall.a.x) / wall.length;
  const dy = (wall.b.y - wall.a.y) / wall.length;
  const closed = opening.hinge === "right" ? { x: -dx, y: -dy } : { x: dx, y: dy };
  const inward = { x: -dy, y: dx };
  const points: Vec2[] = [{ ...hinge }];
  for (let step = 0; step <= 8; step += 1) {
    const theta = (Math.PI / 2) * (step / 8);
    points.push({
      x: hinge.x + opening.width * (closed.x * Math.cos(theta) + inward.x * Math.sin(theta)),
      y: hinge.y + opening.width * (closed.y * Math.cos(theta) + inward.y * Math.sin(theta)),
    });
  }
  return points;
}

/** Returns the width-by-90 cm inward access rectangle for a door or arch; null for windows. */
export function openingClearZone(opening: Opening, room: Room): Vec2[] | null {
  if (opening.kind === "window") return null;
  const { a, b, wall } = openingSegment(opening, room);
  const dx = (wall.b.x - wall.a.x) / wall.length;
  const dy = (wall.b.y - wall.a.y) / wall.length;
  const inward = { x: -dy * 90, y: dx * 90 };
  return [a, b, { x: b.x + inward.x, y: b.y + inward.y }, { x: a.x + inward.x, y: a.y + inward.y }];
}
