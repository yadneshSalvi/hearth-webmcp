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
One distance field supplies its narrowest width; standard/access paths require
60/90 cm. Accessibility also checks 150 cm turning circles and 120 cm reach zones.
The grid is `O(cells × obstacles)` to build and each path is `O(cells log cells)`;
the canonical 520×440 cm room is designed for sub-frame evaluation.
