# Hearth engine frame

All engine geometry is pure TypeScript and uses centimetres. A room owns a local
frame; its `origin` only positions that frame in the home's world layout.

```text
       north / y=0
  NW +-----------------> x east
     | w0
west|                    |east
     |                    |
     v y south            |
       south
```

Room polygons run clockwise from their north-west vertex. Derived wall ids follow
edge order (`w0`, `w1`, …), so rectangular rooms normally have north/east/south/west
as `w0/w1/w2/w3`. An L-room can repeat a compass side; side lookup chooses the
longest edge while id lookup remains exact.

Furniture `pos` is its footprint centre. Rotation is clockwise from above: `0`
faces south, then `90` west, `180` north and `270` east. Boundary touching is
inside but does not count as polygon overlap.

An inward door swing is the swept quarter-disc from the closed leaf to the room
interior. `hinge` is left/right while looking at the wall from inside. Door and
arch clear zones extend 90 cm inward independently of the swing.

E2 should combine `footprint`, clearance and door polygons for conflict records.
E3 should use `resolveWall`, `freeSpans`, `rotationForWall` and `backAgainstWall`
for anchors and fitting. E4 can use catalog resolution and room metrics directly.
R1 should convert room-local points through `roomToWorld`, then cm to metres once.

## Rules

`evaluateRoom` and `evaluateHome` return errors before warnings, then use stable
kind/item ordering. Errors cover overlap, outside-room placement, heavily blocked
clearance, door zones, missing/narrow accessible paths, and turning circles.
Warnings cover partial clearance, standard traffic pinches, reach, and ghost overlap.

Rugs may overlap non-rugs and never block clearance or traffic. Table lamps and
decor may overlap a table, desk, shelf, or TV unit only while fully contained.
Traffic uses a 10 cm occupancy grid and deterministic octile A* between every pair
of doors/arches and from the primary opening to sofa, armchair, bed, and desk use
points. Conflict `zone` stores the simplified raw path polyline for dotted rendering.
Routing first constrains A* to cells that satisfy the required half-width distance.
Endpoint-owned use and door zones remain admissible so routes can enter and leave them.
Only when that pass fails does weighted A* locate the narrowest available pinch to report.
One distance field supplies its narrowest width; standard/access paths require
60/90 cm, excluding each route endpoint's own use/door zone and item footprint.
Accessibility also checks 150 cm turning circles and 120 cm reach zones.
The grid is `O(cells × obstacles)` to build and each path is `O(cells log cells)`;
the canonical 520×440 cm room is designed for sub-frame evaluation.
## Placement

`resolveAnchor` translates wall/along, under-window, centred, next-to and facing
semantics into room-local centres. Position comes from wall → under → centred →
next-to; facing then sets rotation, and raw `pos`/`rotation` win last.

Wall anchors clamp the whole footprint to the wall. Hard-invalid candidates nudge
in alternating 5 cm wall steps or a 5 cm two-axis spiral, up to 60 cm. A blocked
result names obstacles and returns every requested-wall free span with a `fits`
flag and an actionable midpoint or narrower-item suggestion. Windows block an
item only when `item.dims.h > (window.sillHeight ?? 90)`; sofas, beds, desks and
other low pieces may sit below a sill while tall storage must move off its span.
`freeSpans` stays wall-hugging only; product fit also projects blockers through
the product-depth band.
Rugs may stack below anything; lamps/decor may stack fully inside supported surfaces.

`arrangeRoom` excludes preview ghosts, reuses wall-span calculations within one
pass, and preserves its diagnostic `note` so callers can surface an incomplete fit.

`arrangeRoom` classifies anchors, media, surfaces, storage, seating, soft goods,
lighting, greenery and decor, then rebuilds unlocked items around fixed obstacles.
Conversation faces a focal point, media pairs opposite sofa/TV walls, open clears
the centre, and work prioritises a window desk. Seeded tie-breaks make every style
deterministic and idempotent; rugs, lamps, plants and decor finish the composition.
## Describe/report

`describe.ts` is the compact serialization boundary used by read tools. Dimensions,
positions, walls, spans, room rows, selections and carts are kept in the exact
`TOOLS.md` shapes; every final payload must pass the 1,500-character budget check.

`measure.ts` resolves wall sides/ids, item ids/names/selection and opening ids. It
reports dimensions, free spans, gaps and edge-to-edge distances in centimetres.

`report.ts` scores balance, focal direction, conversation, light, storage and
traffic with deterministic room-aware heuristics. Reports stay below the summary
and suggestion limits. `variants.ts` compares saved layouts by catalog display
name, including duplicate counts, movement and colorway changes.
