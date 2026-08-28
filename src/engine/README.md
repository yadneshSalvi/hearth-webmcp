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
