# SCENE_SCHEMA.md — the single scene-graph contract (store, engine, tools, renderer)

All positions/lengths are **centimeters, integers where possible**. Each room has its own local
frame: origin at the room's **north-west corner**, `x` increases **east**, `y` increases **south**.
The home also has world offsets so rooms can be laid out side by side. The renderer converts to
meters exactly once (`cm / 100`).

```ts
type Vec2 = { x: number; y: number };
type Rotation = 0 | 90 | 180 | 270;            // degrees clockwise (top-down); 0 = item front faces SOUTH
type Side = "north" | "east" | "south" | "west";

interface Wall {                                // derived from Room.poly, never stored
  id: string;                                   // "w0".."wn", clockwise from NW corner
  side: Side;                                   // orientation label (L-rooms may have two "north" walls)
  a: Vec2; b: Vec2;                             // endpoints, room-local
  length: number;
}

interface Room {
  id: string;                                   // "living", "bed-1"
  name: string;                                 // "Living Room"
  type: "living" | "bedroom" | "kitchen" | "dining" | "office" | "bath" | "hall" | "studio";
  poly: Vec2[];                                 // clockwise, rectangular or L-shaped (4 or 6 points)
  origin: Vec2;                                 // world offset of the room's NW corner
  floor: "oak" | "pale-oak" | "stone" | "terrazzo";
  wallColor?: string;                           // palette token name, default "plaster"
}

interface Opening {
  id: string;                                   // "door-1", "window-2"
  roomId: string;                               // the room whose wall hosts it (shared walls list the opening once per room)
  wallId: string;                               // Wall.id in that room
  offset: number;                               // cm from wall start (clockwise) to opening start
  width: number;
  kind: "door" | "window" | "arch";
  swing?: "in" | "out";                         // doors only; "in" = swings into this room
  hinge?: "left" | "right";                     // looking at the wall from inside the room
  sillHeight?: number;                          // windows
}

interface CatalogItem {                         // static per product (from Shopify snapshot or built-in kit)
  id: string;                                   // catalog id, e.g. "sofa-endre"
  name: string;
  category: "sofa" | "armchair" | "bed" | "wardrobe" | "table" | "desk" | "chair" | "shelf" | "tv-unit" | "rug" | "floor-lamp" | "table-lamp" | "plant" | "decor";
  dims: { w: number; d: number; h: number };    // cm; w = left-right when facing the item's front
  clearanceFront: number;                       // cm of walkway/use space required in front (sofa 75, bed 60, desk 90…)
  seatCount?: number;
  glb: string;                                  // /assets/glb/....glb
  colorways: { id: string; name: string; hex: string }[];
  styleTags: string[];
  price?: number;                               // USD
  shopify?: { productId: string; variantIds: Record<string, string> };   // colorway id → variant gid
  againstWall?: boolean;                        // sofas/beds/wardrobes prefer a wall; rugs/tables don't
}

interface Furniture {
  id: string;                                   // "sofa-1"
  catalogId: string;
  roomId: string;
  pos: Vec2;                                    // center of footprint, room-local
  rotation: Rotation;
  colorway: string;
  status: "placed" | "ghost";                   // ghost = shop try-in-room preview
  locked?: boolean;                             // arrange_room keeps locked items
  shopifyVariantId?: string;
}

interface Variant { name: string; roomId: string; furniture: Furniture[]; savedAt: number }

interface SceneMeta {
  mode: "build" | "design" | "shop";
  view: "plan" | "dollhouse";
  timeOfDay: "morning" | "noon" | "golden" | "evening";
  paletteId: string;
  accessibilityMode: boolean;
  activeRoomId: string;
  budgetUsd?: number;
  selection: { itemId?: string; roomId?: string; hoverItemId?: string; lastMovedItemId?: string };
}

interface Scene {
  rooms: Room[];
  openings: Opening[];
  furniture: Furniture[];
  variants: Variant[];
  meta: SceneMeta;
}
```

## Derived helpers (engine/geometry.ts)
- `walls(room): Wall[]` · `footprint(item, catalog): Vec2[4]` (rotated rectangle) ·
  `freeSpans(room, wallId): {start,end}[]` (wall segments not blocked by openings or wall-hugging items) ·
  `inside(room, poly)` · `overlap(a,b)`.

## Conflict record (engine output, tool output, overlay input)
```ts
interface Conflict {
  kind: "overlap" | "outside" | "clearance" | "door_swing" | "traffic" | "access_path" | "turning_circle" | "reach";
  items: string[];                              // furniture/opening ids involved
  roomId: string;
  detail: string;                               // ≤ 120 chars, human-readable, with cm
  fix: string;                                  // ≤ 120 chars, actionable ("move sofa-1 40 cm east")
  zone?: Vec2[];                                // polygon to render (room-local)
  severity: "error" | "warn";
}
```

## Templates (`src/engine/templates/`)
`studio` (2 rooms: open studio + bath) · `1br` (5 rooms) · `2br` (6 rooms) · `3br` (7 rooms) ·
`4br` (10 rooms) · `5br` (11 rooms) · `loft` (2 rooms: L-shaped open plan + bath). The 1–5 bedroom
homes include living, kitchen/dining, their named bedrooms, bath(s), and a hall. Each template ships
realistic door swings and exterior windows; every template has an optional deterministic furnished
layout, and `2br` remains the **pre-furnished golden-hour onboarding scene**.

## Invariants (tested)
- Furniture footprint lies inside its room; no two placed items overlap (ghosts may).
- Openings lie within their wall (`offset + width ≤ wall.length`).
- Rotation ∈ {0,90,180,270}; dims are positive; ids unique across the scene.
- Store mutations go through actions in `src/state/store.ts`; tools and pointer share them; every
  mutating action is undoable (zundo) and tagged with `source: "human" | "agent"` for the activity log.

## Stacking (added Aug 29)
`table-lamp` and `decor` items may sit on `table | desk | shelf | tv-unit` surfaces (their footprint fully inside the
surface's footprint); `rug` may lie under anything. The scene stores no elevation: the **renderer elevates** a stackable
item to the top of the surface beneath it (surface `dims.h`), and the conflict engine treats these pairs as non-overlapping.
Conflict `detail`/`fix` are kept ≤ 80 chars in practice so tool outputs need no truncation.
