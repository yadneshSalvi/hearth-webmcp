# TOOLS.md — the WebMCP tool contract for Hearth (registry, handlers, UI, evals all obey this file)

Hearth registers **36 distinct tools, 26 visible by default**, on `document.modelContext`. This file is
the single source of truth for names, titles, descriptions, input schemas, result shapes, output budgets and
the registration lifecycle. Change it here first; code follows. Descriptions are tuned by the lead only.

## 0. Global conventions (every tool obeys these)

- **Units:** centimetres (`cm`) for all lengths, `m²` for areas, **USD** for money. Descriptions state units.
- **Coordinates:** room-local, origin at the room's **north-west corner**, `x` → east, `y` → south, in cm.
  `pos` = centre of an item's footprint. `rotation` ∈ `0 | 90 | 180 | 270`, clockwise from above;
  `0` = the item's front faces **south**. Walls are labelled by side (`north|east|south|west`) and by id (`w0…`).
- **Ids are readable and stable:** rooms `living`, `bed-1`; items `<category>-<n>` (`sofa-1`); openings
  `door-1`, `window-2`; products = Shopify handle (`sofa-endre`); colorways `oak|sage|terracotta|plaster|charcoal|dusty-blue|plum|ochre`.
- **Loose in schema, strict in code.** Every `room` / `item` / `product` / `opening` / `wall` / `colorway` /
  `variant` parameter is a plain string that accepts an **id or a name** (case-insensitive; unique prefix ok).
  `item` also accepts `"selected"` (the human's current selection). `room` defaults to the active room.
  Unresolvable → `{ok:false, error:"not_found", alternatives:[…]}` listing the closest 3 candidates.
- **Parameter aliases.** Models reliably send `room_id`, `item_id` and `product_id` (and the camelCase
  forms) for `room` / `item` / `product`. The published schemas keep the documented names — nothing here
  changes — but `src/tools/params.ts` rewrites those six aliases onto the canonical key before zod parses,
  so a good call is not thrown away as `invalid`. The canonical key wins when both are present, and the
  alias is dropped; nothing inside `anchor` is rewritten.
- **Result envelope (all tools):**
  ```ts
  type Ok  = { ok: true;  [data: string]: unknown; conflicts?: ConflictLite[]; hint?: string };
  type Err = { ok: false; error: "blocked"|"not_found"|"invalid"|"needs_confirmation"|"cancelled"|"unavailable";
               detail: string; suggestion?: string; alternatives?: string[]; [extra: string]: unknown };
  type ConflictLite = { kind: Conflict["kind"]; severity: "error"|"warn"; items: string[]; detail: string; fix: string }; // detail/fix ≤ 80 chars
  ```
  `hint` is one sentence (≤ 120 chars) telling the agent the natural next step. Errors are **actionable**
  ("blocked by wardrobe-2; free spans on north wall: 0–140 cm, 260–420 cm") so the model can self-correct.
  Handlers return **plain JSON objects** (the browser serialises them); never MCP `content[]` wrappers. Throwing
  is a bug — every failure is an `Err`.
- **Budgets (Chrome guidance, enforced by `tests/tools/budget.test.ts`):** tool name ≤ 30 chars · description
  ≤ 500 · each parameter description ≤ 150 · parameter name ≤ 30 · `JSON.stringify(result).length ≤ 1500` for
  every tool on the three fixtures (empty home / furnished 2BR / worst-case 2BR with 40 items + 12 conflicts).
  Each tool below states its truncation policy; `more: n` reports omitted rows.
- **Annotations:** `R` = `readOnlyHint: true` (all reads). `U` = `untrustedContentHint: true` (outputs carry
  Shopify-sourced text). Nothing else is supported by Chrome/ChatGPT today.
- **Side effects are visible before the promise resolves:** the store is updated, the orb has flown, the receipt
  line is written, then the result returns (Chrome: "update UI state before returning").
- **Confirmation:** `clear_room` and `apply_template` (on a furnished home) open an in-page dialog and await it;
  45 s without an answer → `{ok:false, error:"cancelled", detail:"No confirmation within 45 s"}`; decline → `cancelled`.
- **Coordinates never leak math to the model:** anchors (`§1`) do the geometry; raw `pos` is an override only.
- **Every mutating tool result includes `room`** (id) and the affected item ids so the agent can verify.

## 1. Shared parameter shapes

### 1.1 `anchor` (place_furniture · move_furniture · preview_in_room)
```ts
anchor?: {
  wall?:     string;                      // "north"|"east"|"south"|"west" or a wall id (w0…): back goes against this wall
  along?:    "start"|"center"|"end"|number; // where along the wall; number = cm from the wall's start (clockwise). Default center
  facing?:   string;                      // item id/name, "room_center", "wall:<side>" or "window:<id>" — sets rotation
  next_to?:  string;                      // item id/name to sit beside
  side?:     "left"|"right"|"front"|"behind"; // which side of next_to (from that item's point of view). Default right
  gap_cm?:   number;                      // gap to next_to, default 10
  centered?: boolean;                     // centre of the room
  under?:    string;                      // "window:<id>" — centred under that window, back to its wall
}
pos?: { x: number; y: number };           // raw override, cm, room-local
rotation?: 0 | 90 | 180 | 270;
```
Parameter descriptions (≤ 150 chars each, used verbatim in the JSON Schema):
- `anchor` — "Where to put it, in words: wall + along, facing, next_to + side + gap_cm, centered, or under a window. Preferred over pos."
- `anchor.wall` — "Wall the back goes against: north, east, south, west, or a wall id such as w2."
- `anchor.along` — "Position along that wall: start, center, end, or a number of cm from the wall's start (clockwise)."
- `anchor.facing` — "What the front faces: an item id or name, room_center, wall:<side>, or window:<id>."
- `anchor.next_to` — "Item id or name to sit beside."
- `anchor.side` — "Side of next_to to use: left, right, front or behind (from that item's point of view)."
- `anchor.gap_cm` — "Gap in cm between the two items (default 10)."
- `anchor.centered` — "true to centre the item in the room."
- `anchor.under` — "window:<id> to centre the item under that window with its back to the wall."
- `pos` — "Raw footprint centre in cm, room-local (origin north-west corner, x east, y south). Use anchor when possible."
- `rotation` — "0, 90, 180 or 270 degrees clockwise; 0 = front faces south."

Resolution (`src/engine/anchors.ts`): `wall` → back flush to the wall (rotation derived: north wall ⇒ 0, east ⇒ 90,
south ⇒ 180, west ⇒ 270 — the front faces away from the wall), `along` positions the centre; `facing` overrides rotation; `next_to` computes the
neighbour offset from both footprints; `centered`/`under` as named. If the exact spot collides or leaves the room,
nudge along the wall/axis up to **60 cm** (5 cm steps, nearest first) and report `nudged_cm`; else return
`{ok:false, error:"blocked", detail, free_spans:[{wall,start,end}], suggestion}`.

### 1.2 Common parameters
- `room` — "Room id or name, e.g. living or Living Room. Defaults to the active room."
- `item` — "Placed item id (e.g. sofa-1) or its name. Use selected for the human's current selection."
- `product` — "Catalog product id (e.g. sofa-endre) or product name from search_catalog."
- `colorway` — "Colorway id or name, e.g. oak, sage, terracotta, dusty-blue."
- `opening` — "Opening id, e.g. door-1 or window-2."

## 2. Groups and gates

| Group | Tools | Registered when |
|---|---|---|
| `core` | 1–10 | always (on mount, before first paint of the status chip) |
| `design` | 11–23 | always |
| `shop` | 24–25 | always |
| `present` | 26 | always |
| `preview` | 27–28 | a ghost (preview) item exists |
| `variants` | 29 | the active room has ≥ 2 saved variants |
| `checkout` | 30 | the cart has ≥ 1 line |
| `build` | 31–36 | `meta.mode === "build"` |

Visible by default = core 10 + design 13 + shop 2 + present 1 = **26**.

## 3. The tools

Format: **name** · group · annotations → title · description (verbatim, ≤ 500 chars) · input (zod-ish) ·
result · budget policy · receipt summary (≤ 80 chars, shown in the Activity log).

---

### 1. `get_scene_summary` · core · R
**Title:** Scene summary
**Description:** Overview of the whole home: every room with id, name, type, size in m², wall sides with lengths in cm, item count and conflict count; plus the current mode, view, time of day, accessibility flag, active room, the human's selection, cart subtotal and design budget in USD. Call it first to learn room and item ids before reading details or placing furniture.
**Input:** `{}`
**Result:**
```json
{"ok":true,"home":{"template":"2br","rooms":6,"items":23},"mode":"design","view":"dollhouse","time_of_day":"golden",
 "accessibility":false,"active_room":"living",
 "rooms":[{"id":"living","name":"Living Room","type":"living","area_m2":22.9,"walls":"N 520 · E 440 · S 520 · W 440","items":7,"conflicts":1}],
 "selection":{"item":"sofa-1","room":"living"},"cart":{"lines":2,"subtotal_usd":1240},"budget_usd":3000,
 "hint":"Use get_room_details for walls, openings and item positions of one room."}
```
**Budget:** rooms are compact rows (walls as one string); ≤ 8 rooms then `more`. No item lists here.
**Receipt:** "Read scene summary"

### 2. `get_room_details` · core · R
**Title:** Room details
**Description:** Details of one room: walls (id, side, length in cm and the free spans where furniture can go), openings (doors, windows, arches with wall, offset, width and swing) and every placed item with id, name, position, rotation, footprint and colorway. Coordinates are room-local in cm: origin at the north-west corner, x east, y south. Use it before placing or moving furniture in that room.
**Input:** `{ room?: string }`
**Result:**
```json
{"ok":true,"room":{"id":"living","name":"Living Room","type":"living","size_cm":"520x440","area_m2":22.9,"floor":"oak","wall_color":"plaster"},
 "walls":[{"id":"w0","side":"north","length_cm":520,"free_spans":"0-140,260-520"}],
 "openings":[{"id":"door-1","kind":"door","wall":"w3","offset_cm":40,"width_cm":90,"swing":"in","hinge":"left"}],
 "items":["sofa-1 Endre Sofa @260,410 r0 220x95 oak","rug-1 Loop Rug @260,240 r90 200x300 terracotta"],
 "more":0,"conflicts":1,"hint":"Items are 'id name @x,y rotation WxD colorway'. measure gives gaps and spans."}
```
**Budget:** items as compact strings, ≤ 12 then `more`; walls ≤ 6 (L-rooms); openings ≤ 8.
**Receipt:** "Read Living Room details"

### 3. `get_selection` · core · R
**Title:** Human selection
**Description:** What the human is pointing at right now: the selected item, hovered item, last moved item (and whether the human or the agent moved it), the selected room and the camera focus. Use it to resolve words like this, that, here or the one I clicked before acting.
**Input:** `{}`
**Result:** `{"ok":true,"selected_item":{"id":"sofa-1","name":"Endre Sofa","room":"living","pos":[260,410],"rotation":0,"dims":"220x95x85"},"hovered_item":null,"last_moved":{"id":"armchair-1","by":"human","ago_s":12},"selected_room":"living","camera":{"view":"dollhouse","focus":"living"},"hint":"…"}`
**Budget:** fixed size (< 600 chars).
**Receipt:** "Read selection"

### 4. `measure` · core · R
**Title:** Measure
**Description:** Measures in cm: a wall's length and free spans, an item's footprint, the gap between two items, or the distance from an item to a wall or opening. Subjects are wall sides (north, east, south, west), wall ids (w0…), item ids or names, or opening ids. Use it to check fit before placing or moving.
**Input:** `{ subject: string, to?: string, room?: string }`
- `subject` — "What to measure: a wall side or id, an item id or name, or an opening id."
- `to` — "Optional second thing (wall, item or opening) to measure the gap or distance to."
**Result:** `{"ok":true,"subject":{"kind":"wall","id":"w0","side":"north"},"length_cm":520,"free_spans":[{"start":0,"end":140},{"start":260,"end":520}],"hint":"…"}` · with `to`: `{"ok":true,"subject":{…},"to":{…},"gap_cm":35,"direction":"east","hint":"…"}`
**Budget:** ≤ 6 spans.
**Receipt:** "Measured north wall" / "Measured sofa-1 → armchair-1"

### 5. `get_conflicts` · core · R
**Title:** Layout conflicts
**Description:** Lists layout problems in a room or the whole home: overlapping items, items outside the room, missing clearance in front of seating, beds and desks, blocked door swings, pinched traffic paths and, when accessibility mode is on, paths under 90 cm and missing 150 cm turning circles. Each conflict names the items involved and a concrete fix in cm.
**Input:** `{ room?: string }` — `room` — "Room id or name, or all for the whole home. Defaults to the active room."
**Result:** `{"ok":true,"room":"living","accessibility_mode":false,"count":3,"conflicts":[{"kind":"door_swing","severity":"error","items":["armchair-1","door-1"],"detail":"armchair-1 sits in door-1's swing arc","fix":"move armchair-1 40 cm east"}],"more":0,"hint":"…"}`
**Budget:** ≤ 6 conflicts (errors first) then `more`; `detail`/`fix` ≤ 80 chars.
**Receipt:** "Checked conflicts in Living Room (3)"

### 6. `get_design_report` · core · R
**Title:** Design report
**Description:** Design critique of a room scored 0–10 on balance, focal point, conversation seating, lighting coverage, storage and traffic flow, with an overall score out of 100 and the top three improvements. Use it to review a layout or to explain why a room feels off.
**Input:** `{ room?: string }`
**Result:** `{"ok":true,"room":"living","score":72,"scores":{"balance":7,"focal_point":8,"conversation":6,"lighting":7,"storage":5,"traffic":8},"summary":"…≤200 chars","suggestions":["Add a floor lamp by the armchair (north-east corner is dark)."],"hint":"…"}`
**Budget:** summary ≤ 200 chars, ≤ 3 suggestions ≤ 120 chars each.
**Receipt:** "Design report for Living Room · 72/100"

### 7. `search_catalog` · core · R U
**Title:** Search catalog
**Description:** Searches Hearth Studio's furniture catalog (Shopify). Filter by category, maximum price in USD, maximum width and depth in cm, style, colorway, or the wall it must fit (fits_wall) in a room. Returns up to 6 products with id, price, dimensions, colorways and a fit note such as fits north wall · 12 cm spare. Product ids from here are used by place_furniture, preview_in_room and update_cart.
**Input:**
```ts
{ query?: string; category?: Category; max_price_usd?: number; max_width_cm?: number; max_depth_cm?: number;
  fits_wall?: string; room?: string; style?: string; colorway?: string; limit?: number /* 1–6, default 6 */ }
```
- `query` — "Free-text search, e.g. small oak desk."
- `category` — enum `sofa|armchair|bed|wardrobe|table|desk|chair|shelf|tv-unit|rug|floor-lamp|table-lamp|plant|decor`.
- `fits_wall` — "Only products whose width fits a free span on this wall (north, east, south, west or wall id) of the room."
- `style` — "Style tag such as scandinavian, japandi, mid-century, rustic, modern."
**Result:** `{"ok":true,"count":4,"results":[{"id":"sofa-endre","name":"Endre Sofa","category":"sofa","price_usd":790,"dims":"220x95x85","colorways":"oak, sage, terracotta","fit":"fits north wall · 40 cm spare","style":"scandinavian"}],"hint":"…"}`
**Budget:** ≤ 6 rows, no descriptions, colorways as one string.
**Receipt:** "Searched catalog: sofas under $800 (4)"

### 8. `get_product` · core · R U
**Title:** Product details
**Description:** Full details of one catalog product: dimensions in cm, price in USD, colorways, front clearance needed, seat count, style tags and which walls of a room it fits with the spare cm. Use it to confirm a product before placing, previewing or adding it to the cart.
**Input:** `{ product: string, room?: string }`
**Result:** `{"ok":true,"product":{"id":"sofa-endre","name":"Endre Sofa","category":"sofa","price_usd":790,"dims":"220x95x85","clearance_front_cm":75,"seat_count":3,"colorways":["oak","sage","terracotta"],"style_tags":["scandinavian"],"description":"…≤200"},"fits":{"room":"living","walls":[{"wall":"w0","side":"north","fits":true,"spare_cm":40}]},"in_scene":["sofa-1"],"hint":"…"}`
**Budget:** description ≤ 200 chars; walls ≤ 6.
**Receipt:** "Read product Endre Sofa"

### 9. `get_cart` · core · R
**Title:** Cart
**Description:** The shopping cart: each line with product, colorway, quantity, unit and line price in USD, the subtotal, the design budget and how much of it remains, and whether checkout is available. Lines note which placed item they belong to.
**Input:** `{}`
**Result:** `{"ok":true,"lines":[{"product":"sofa-endre","name":"Endre Sofa","colorway":"oak","qty":1,"unit_usd":790,"line_usd":790,"item":"sofa-1"}],"count":2,"subtotal_usd":1240,"budget_usd":3000,"remaining_usd":1760,"checkout_available":true,"hint":"…"}`
**Budget:** ≤ 10 lines then `more`.
**Receipt:** "Read cart · $1,240"

### 10. `set_mode` · core
**Title:** Switch mode
**Description:** Switches the studio mode. build: edit rooms and openings (enables apply_template, create_room, update_room, add_opening, move_opening and remove_opening). design: place and arrange furniture. shop: browse products and manage the cart with prices shown. Design and shop tools stay available in every mode.
**Input:** `{ mode: "build"|"design"|"shop" }`
**Result:** `{"ok":true,"mode":"build","hint":"Build tools are now available: create_room, add_opening…"}`
**Receipt:** "Switched to Build mode"

---

### 11. `place_furniture` · design
**Title:** Place furniture
**Description:** Places a catalog product in a room as a new item. Position it with an anchor in words (back against a wall at start, center, end or N cm along it; facing an item or the room centre; next to an item with a gap; centred; or under a window) or with a raw pos in cm and a rotation. The engine snaps to the wall, nudges up to 60 cm to avoid collisions and reports conflicts. Returns the new item id.
**Input:** `{ product: string, room?: string, anchor?: Anchor, pos?: Vec2, rotation?: Rotation, colorway?: string }`
**Result:** `{"ok":true,"room":"living","item":{"id":"sofa-2","name":"Endre Sofa","product":"sofa-endre","pos":[260,48],"rotation":0,"dims":"220x95x85","colorway":"oak","price_usd":790},"nudged_cm":15,"conflicts":[],"hint":"…"}`
**Errors:** `blocked` (+`free_spans`, `suggestion`), `not_found` (+`alternatives`), `invalid`.
**Receipt:** "Placed Endre Sofa on the north wall"

### 12. `move_furniture` · design
**Title:** Move furniture
**Description:** Moves and/or rotates a placed item. Give an anchor in words (wall + along, facing, next_to, centered, under), a raw pos in cm, a delta in cm, a rotation (0, 90, 180 or 270 clockwise; 0 faces south) or rotate_by, and optionally another room. Snaps and nudges like place_furniture and returns the resolved position and any conflicts.
**Input:** `{ item: string, anchor?: Anchor, pos?: Vec2, delta_cm?: { x?: number; y?: number }, rotation?: Rotation, rotate_by?: 90|-90|180, room?: string }`
- `delta_cm` — "Shift by this many cm: x positive = east, y positive = south."
- `rotate_by` — "Turn by 90 (clockwise), -90 (counter-clockwise) or 180 degrees."
- `room` — "Move the item into this room (id or name). Defaults to its current room."
**Result:** `{"ok":true,"room":"living","item":{"id":"sofa-1","name":"Endre Sofa","pos":[260,48],"rotation":0},"moved_cm":362,"nudged_cm":0,"conflicts":[],"hint":"…"}`
**Receipt:** "Moved Endre Sofa to the north wall"

### 13. `remove_furniture` · design
**Title:** Remove furniture
**Description:** Removes one placed item from its room. If the item is linked to a cart line, that line is removed as well and the result says so. Use clear_room to empty a whole room.
**Input:** `{ item: string }`
**Result:** `{"ok":true,"room":"living","removed":{"id":"armchair-1","name":"Nook Armchair"},"cart_line_removed":false,"hint":"Undo restores the item, but a removed Shopify cart line must be re-added."}`
**Receipt:** "Removed Nook Armchair"

### 14. `set_colorway` · design
**Title:** Set colorway
**Description:** Changes a placed item's colorway (for example oak, sage, terracotta or dusty-blue). If the product is in the cart, the cart line switches to the matching variant. Lists the available colorways when the requested one is unknown.
**Input:** `{ item: string, colorway: string }`
**Result:** `{"ok":true,"room":"living","item":{"id":"sofa-1","name":"Endre Sofa","colorway":"sage"},"cart_line_updated":true,"available":["oak","sage","terracotta"],"hint":"…"}`
**Receipt:** "Endre Sofa → sage"

### 15. `arrange_room` · design
**Title:** Arrange room
**Description:** Re-arranges all unlocked furniture in a room in one animated pass. Styles: conversation (seating faces each other around a focal point), media (seating faces the TV or media wall), open (maximum clear floor and walkways), work (desk by the window, storage on the walls). Keeps door swings and clearances free and reports what moved with the conflict count before and after.
**Input:** `{ room?: string, style: "conversation"|"media"|"open"|"work", keep_locked?: boolean /* default true */, focus?: string }`
- `focus` — "Optional focal point: an item id or name (e.g. the fireplace or TV) or window:<id>."
**Result:** `{"ok":true,"room":"living","style":"conversation","moved":[{"id":"sofa-1","name":"Endre Sofa","to":[260,48],"rotation":0}],"kept":["rug-1"],"conflicts_before":3,"conflicts_after":0,"note":"Arranged Living Room for conversation · 6 moved","hint":"…"}`
**Budget:** `moved` ≤ 10 rows then `more`; names ≤ 24 chars.
**Receipt:** "Arranged Living Room · conversation (6 moved)"

### 16. `apply_palette` · design
**Title:** Apply palette
**Description:** Applies a palette preset to a room or the whole home: wall colour, floor material and the textile family used for re-tinted fabrics. Presets: warm-clay, sage-linen, dusk, nordic, terrazzo, ochre-sun.
**Input:** `{ palette: "warm-clay"|"sage-linen"|"dusk"|"nordic"|"terrazzo"|"ochre-sun", room?: string, scope?: "room"|"home" /* default room */ }`
**Result:** `{"ok":true,"palette":{"id":"sage-linen","name":"Sage linen","walls":"plaster","floor":"pale-oak","textiles":"sage"},"rooms":["living"],"hint":"…"}`
**Presets:** `warm-clay` plaster/oak/terracotta · `sage-linen` plaster/pale-oak/sage · `dusk` plum-tint/stone/dusty-blue · `nordic` plaster/pale-oak/dusty-blue · `terrazzo` plaster/terrazzo/ochre · `ochre-sun` ochre-tint/oak/ochre (wall tints = token @ 14 % over plaster; see STYLE.md).
**Receipt:** "Applied Sage linen to Living Room"

### 17. `set_time_of_day` · design
**Title:** Time of day
**Description:** Sets the lighting time of day: morning (cool soft light), noon (bright with short shadows), golden (warm low sun) or evening (dusk, every lamp glows). Changes the look only; the layout stays the same.
**Input:** `{ time: "morning"|"noon"|"golden"|"evening" }`
**Result:** `{"ok":true,"time_of_day":"evening","lamps_on":true,"hint":"…"}`
**Receipt:** "Time of day → evening"

### 18. `set_view` · design
**Title:** Set view
**Description:** Changes the camera: plan (top-down) or dollhouse (isometric), optionally focused on a room or an item, with the isometric yaw at nw, ne, se or sw. Use it to show the human what you are working on.
**Input:** `{ view?: "plan"|"dollhouse", focus?: string, yaw?: "nw"|"ne"|"se"|"sw" }`
- `focus` — "Room id/name or item id/name to frame. Defaults to the active room."
**Result:** `{"ok":true,"view":"dollhouse","focus":{"kind":"item","id":"sofa-1"},"yaw":"sw","hint":"…"}`
**Receipt:** "View → dollhouse, focus Endre Sofa"

### 19. `set_accessibility_mode` · design
**Title:** Accessibility mode
**Description:** Turns accessibility mode on or off. On: paths must be at least 90 cm wide, a 150 cm turning circle is required beside the bed, desk and sofa, reach zones are shown, and get_conflicts and the overlays report these rules. Off: standard 60 cm walkways.
**Input:** `{ enabled: boolean }`
**Result:** `{"ok":true,"accessibility_mode":true,"conflicts":4,"hint":"get_conflicts lists the 4 accessibility issues."}`
**Receipt:** "Accessibility mode on (4 conflicts)"

### 20. `undo` · design
**Title:** Undo
**Description:** Undoes the last change(s) to the scene, whether made by the agent or the human, 1 to 10 steps at a time. Returns what was undone.
**Input:** `{ steps?: number /* 1–10, default 1 */ }`
**Result:** `{"ok":true,"undone":[{"action":"move_furniture","summary":"Moved Endre Sofa to the north wall","by":"agent"}],"remaining":6,"hint":"Scene undo does not recreate Shopify lines removed with furniture; use update_cart."}`
**Receipt:** "Undid 1 change"

### 21. `save_variant` · design
**Title:** Save variant
**Description:** Saves the current furniture layout of a room under a name (for example Cosy or Media wall) so it can be restored with load_variant or, once two or more exist, compared side by side with compare_variants.
**Input:** `{ name: string, room?: string }`
**Result:** `{"ok":true,"room":"living","variant":{"name":"Cosy","items":7},"variants":["Cosy","Media wall"],"hint":"compare_variants is available once two variants exist."}`
**Receipt:** "Saved variant “Cosy”"

### 22. `load_variant` · design
**Title:** Load variant
**Description:** Restores a previously saved layout variant of a room by name, replacing the room's current furniture. Save the current layout first if you want to keep it.
**Input:** `{ variant: string, room?: string }` — `variant` — "Saved variant name (see save_variant)."
**Result:** `{"ok":true,"room":"living","variant":"Cosy","items":7,"replaced":6,"hint":"…"}`
**Receipt:** "Loaded variant “Cosy”"

### 23. `clear_room` · design · **confirm**
**Title:** Clear room
**Description:** Removes every item from a room after the human confirms in a dialog on the page. Returns cancelled if the human declines.
**Input:** `{ room?: string }`
**Result:** `{"ok":true,"room":"living","removed":7,"hint":"undo restores them."}` · `{"ok":false,"error":"cancelled","detail":"The human declined to clear Living Room."}`
**Receipt:** "Cleared Living Room (7 items)" / "Clear Living Room — declined"

---

### 24. `preview_in_room` · shop
**Title:** Preview in room
**Description:** Try before you buy: shows a translucent ghost of a catalog product at an anchor or position in a room with its price, fit and conflicts, without changing the layout or the cart. One preview at a time; confirm_preview keeps it and cancel_preview discards it.
**Input:** `{ product: string, room?: string, anchor?: Anchor, pos?: Vec2, rotation?: Rotation, colorway?: string }`
**Result:** `{"ok":true,"room":"living","preview":{"id":"ghost-1","product":"sofa-endre","name":"Endre Sofa","pos":[260,48],"rotation":0,"dims":"220x95x85","colorway":"oak","price_usd":790},"fit":"fits north wall · 40 cm spare","conflicts":[],"hint":"Call confirm_preview to keep it or cancel_preview to discard it."}`
**Receipt:** "Previewing Endre Sofa on the north wall"

### 25. `update_cart` · shop
**Title:** Update cart
**Description:** Changes the Shopify cart. add: adds a product (by product id or a placed item) in a colorway with a quantity; remove: removes that product's line; set_quantity: sets the line's quantity. Returns the new subtotal in USD and the remaining budget. Purchases are completed by the human at checkout.
**Input:** `{ action: "add"|"remove"|"set_quantity", product?: string, item?: string, colorway?: string, quantity?: number }`
- `product` — "Catalog product id or name. Give either product or item."
- `item` — "Placed item id or name; its product and colorway are used and the cart line is linked to it."
- `quantity` — "Quantity for add (default 1) or set_quantity."
**Result:** `{"ok":true,"action":"add","line":{"product":"sofa-endre","name":"Endre Sofa","colorway":"oak","qty":1,"line_usd":790,"item":"sofa-1"},"count":2,"subtotal_usd":1240,"remaining_usd":1760,"checkout_available":true,"hint":"…"}`
**Errors:** `unavailable` when Shopify is unreachable (cart is kept locally and retried).
**Receipt:** "Added Endre Sofa (oak) to cart · $1,240"

### 26. `export_design_board` · present
**Title:** Export design board
**Description:** Creates a design board PNG for a room: dollhouse render, plan view, palette swatches and an itemised list with prices and the total, then starts the download in the page. Use it to present or share a finished layout.
**Input:** `{ room?: string, title?: string }` — `title` — "Board title (default the room name)."
**Result:** `{"ok":true,"room":"living","board":{"title":"Living Room","items":7,"total_usd":2140,"size_px":"1600x1000"},"download":"started","hint":"…"}`
**Receipt:** "Exported design board · Living Room"

---

### 27. `confirm_preview` · preview (gated: ghost exists)
**Title:** Confirm preview
**Description:** Keeps the current preview: the ghost becomes a placed item with its colorway and Shopify variant linked. Optionally adds it to the cart in the same step.
**Input:** `{ add_to_cart?: boolean }`
**Result:** `{"ok":true,"room":"living","item":{"id":"sofa-2","name":"Endre Sofa","pos":[260,48],"rotation":0,"colorway":"oak"},"cart":{"added":true,"subtotal_usd":2030},"hint":"…"}`
**Receipt:** "Kept Endre Sofa (added to cart)"

### 28. `cancel_preview` · preview (gated: ghost exists)
**Title:** Cancel preview
**Description:** Discards the current preview ghost without changing the layout or the cart.
**Input:** `{}`
**Result:** `{"ok":true,"room":"living","discarded":{"product":"sofa-endre","name":"Endre Sofa"},"hint":"…"}`
**Receipt:** "Discarded preview of Endre Sofa"

### 29. `compare_variants` · variants (gated: ≥ 2 variants in the active room)
**Title:** Compare variants
**Description:** Shows two saved layout variants of a room side by side with a draggable split slider and returns their differences (items only in one of them, items that moved) and the conflict count of each. Any layout change closes the comparison.
**Input:** `{ left: string, right: string, room?: string }` — `left`/`right` — "Saved variant name for the left/right half."
**Result:** `{"ok":true,"room":"living","left":"Cosy","right":"Media wall","diff":{"only_left":["Nook Armchair"],"only_right":["Media Unit"],"moved":["Endre Sofa"]},"conflicts":{"left":0,"right":2},"hint":"…"}`
**Budget:** each diff list ≤ 8 names.
**Receipt:** "Comparing “Cosy” vs “Media wall”"

### 30. `get_checkout_link` · checkout (gated: cart non-empty) · R
**Title:** Checkout link
**Description:** Returns the Shopify checkout URL for the current cart together with the store password. The human opens the link, enters the password once, and completes the purchase themselves (this is a test store: card number 1 succeeds).
**Input:** `{}`
**Result:** `{"ok":true,"checkout_url":"https://hearth-studio.myshopify.com/checkouts/cn/…","store_password":"…","count":2,"subtotal_usd":1240,"note":"Development store: the checkout asks for the store password first.","hint":"Share the link and password with the human; they complete the purchase."}`
**Receipt:** "Prepared checkout link · $1,240"

---

### 31. `apply_template` · build · **confirm if the home has furniture**
**Title:** Apply floor-plan template
**Description:** Replaces the whole home with a floor-plan template: studio, 1br, 2br (living, kitchen and dining, two bedrooms, bath, hall) or loft (L-shaped open plan), each with doors and windows; furnished adds a starter layout. Asks the human to confirm when the current home already has furniture.
**Input:** `{ template: "studio"|"1br"|"2br"|"loft", furnished?: boolean }`
**Result:** `{"ok":true,"template":"2br","rooms":["living","kitchen","bed-1","bed-2","bath","hall"],"openings":11,"items":23,"hint":"…"}`
**Receipt:** "Applied 2BR template (furnished)"

### 32. `create_room` · build
**Title:** Create room
**Description:** Adds a room with a name, type and size in cm, rectangular or L-shaped (a notched corner), placed beside an existing room (east_of, south_of, west_of, north_of) or at the home's free edge. Returns the room id and its walls.
**Input:**
```ts
{ name: string; type: RoomType; width_cm: number; depth_cm: number;
  notch?: { corner: "ne"|"se"|"sw"|"nw"; width_cm: number; depth_cm: number };
  place?: "east_of"|"south_of"|"west_of"|"north_of"; relative_to?: string; floor?: "oak"|"pale-oak"|"stone"|"terrazzo" }
```
- `notch` — "For an L-shape: which corner to cut away and the cut's width and depth in cm."
- `place`/`relative_to` — "Put the new room on this side of relative_to (room id or name)."
**Result:** `{"ok":true,"room":{"id":"office","name":"Office","type":"office","size_cm":"360x320","area_m2":11.5,"walls":"N 360 · E 320 · S 360 · W 320"},"hint":"add_opening adds a door; set_mode design to furnish."}`
**Receipt:** "Created Office · 360×320 cm"

### 33. `update_room` · build
**Title:** Update room
**Description:** Changes a room's name, type, width and depth in cm, floor material or wall colour. Items that no longer fit are reported so you can move them.
**Input:** `{ room?: string, name?: string, type?: RoomType, width_cm?: number, depth_cm?: number, floor?: Floor, wall_color?: WallColor }`
**Result:** `{"ok":true,"room":{"id":"living","name":"Living Room","size_cm":"560x440","area_m2":24.6},"items_outside":["shelf-1"],"conflicts":[…],"hint":"…"}`
**Receipt:** "Updated Living Room · 560×440 cm"

### 34. `add_opening` · build
**Title:** Add opening
**Description:** Adds a door, window or arch to a wall of a room at an offset from the wall's start (or start, center, end) with a width in cm; doors take a swing (in or out) and hinge (left or right), windows a sill height. Reports items that now block the door swing.
**Input:** `{ room?: string, wall: string, kind: "door"|"window"|"arch", offset_cm?: number|"start"|"center"|"end", width_cm?: number, swing?: "in"|"out", hinge?: "left"|"right", sill_height_cm?: number }`
- `wall` — "Wall side (north, east, south, west) or wall id (w0…)."
- `offset_cm` — "Distance in cm from the wall's start (clockwise) to the opening, or start, center, end."
- `width_cm` — "Opening width in cm (defaults: door 90, window 120, arch 140)."
**Result:** `{"ok":true,"room":"living","opening":{"id":"window-3","kind":"window","wall":"w0","offset_cm":200,"width_cm":120},"conflicts":[],"hint":"…"}`
**Receipt:** "Added window on the north wall"

### 35. `move_opening` · build
**Title:** Move opening
**Description:** Moves or resizes an existing opening: a new wall, offset in cm, width, swing or hinge. Reports items that block the new door swing.
**Input:** `{ opening: string, wall?: string, offset_cm?: number|"start"|"center"|"end", width_cm?: number, swing?: "in"|"out", hinge?: "left"|"right" }`
**Result:** `{"ok":true,"room":"living","opening":{"id":"door-1","kind":"door","wall":"w3","offset_cm":120,"width_cm":90,"swing":"in","hinge":"left"},"conflicts":[],"hint":"…"}`
**Receipt:** "Moved door-1 to 120 cm on the west wall"

### 36. `remove_opening` · build
**Title:** Remove opening
**Description:** Removes a door, window or arch by id.
**Input:** `{ opening: string }`
**Result:** `{"ok":true,"room":"living","removed":{"id":"window-2","kind":"window"},"hint":"…"}`
**Receipt:** "Removed window-2"

## 4. Registration lifecycle (`src/tools/registry.ts`)

```ts
type ToolGroup = "core"|"design"|"shop"|"present"|"preview"|"variants"|"checkout"|"build";

interface ToolSpec<I extends z.ZodObject> {
  name: string; title: string; description: string; group: ToolGroup;
  input: I;                                   // zod → JSON Schema via z.toJSONSchema(input, { target: "draft-7" }) — no $refs, no unions in top-level params except anyOf for along/offset
  readOnly?: boolean; untrusted?: boolean;
  confirm?: (input: z.infer<I>, s: Scene) => string | null;   // message → await ui.confirm(message); null = no dialog
  handler: (input: z.infer<I>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
  summarize: (input: z.infer<I>, result: ToolResult) => string; // receipt line ≤ 80 chars
}
interface ToolContext { store: HearthStore; ui: { confirm(msg: string): Promise<{accepted:boolean;reason:"accepted"|"declined"|"timeout"|"cancelled"}>; focus(target: Focus): void; pulse(ids: string[]): void }; shopify: ShopifyClient; signal?: AbortSignal; source: "agent"|"assistant"|"test" }
```

- `defineTool(spec)` validates budgets at definition time (throws in dev/test) and produces the WebMCP tool
  object `{ name, title, description, inputSchema, annotations, execute }`. `execute` = parse with zod
  (`safeParse`; failure → `{ok:false,error:"invalid",detail}`) → `executing++` → optional confirm → handler →
  write receipt → `executing--` → return the plain object. Confirmation returns its reason directly.
- **Groups:** one `AbortController` per group. `sync(scene)` computes the desired set:
  `core|design|shop|present` always; `build` iff `meta.mode==="build"`; `preview` iff a `status:"ghost"` item exists;
  `variants` iff the active room has ≥ 2 variants; `checkout` iff cart lines ≥ 1. Diff → `registerTool` for new
  groups, `abort()` for stale ones.
- **Deferral rule (Chrome < 153 cancels in-flight executions on abort):** never abort while `executing > 0`;
  queue the sync and flush on a macrotask (`setTimeout(…, 50)`) after the last executing tool resolved. Registration
  (no abort) may happen immediately. `set_mode`, `confirm_preview`, `cancel_preview`, `update_cart remove` therefore
  return first and the group flips right after.
- **Static descriptions.** Nothing in a description depends on scene state (no re-registration churn). Live
  context is returned by `get_scene_summary`; every mutating result carries `room`.
- **Feature detection:** `typeof document.modelContext?.registerTool === "function"`. Registration happens
  synchronously in the Studio's first client effect so DevTools/Lighthouse list the 26 default tools cold.
- **Mirror:** a `toolchange` listener calls `getTools()` and stores `{name,title,description,inputSchema}` in the
  store for the Tools panel and the status chip ("Agent tools · 26 ready"). Registry exposes `execute(name, input)`
  for tests and the fallback assistant (identical path → identical orb/receipt behaviour); non-test mirror calls
  are rejected with `blocked` when the tool's group gate is closed.
- **Receipts:** every execution appends `{ id, t, source, tool, title, summary, input, result, itemIds }` to
  `activity[]` (cap 200). Human actions append `{ source:"human", summary:"You moved Endre Sofa" }` rows. A
  parallel history-label stack records only undoable scene transitions, so read receipts and selection do not
  displace the action returned by `undo`.

## 5. Eval anchors (how prompts should map; full sheet in `evals/prompts.json`)
| Prompt | Expected call(s) |
|---|---|
| "What's in the living room?" | `get_room_details {room:"living"}` (after `get_scene_summary` if ids unknown) |
| "Put the sofa against the north wall facing the window" | `place_furniture/move_furniture {anchor:{wall:"north", facing:"window:…"}}` |
| "Find a sofa under $800 that fits the north wall" | `search_catalog {category:"sofa", max_price_usd:800, fits_wall:"north"}` |
| "Try the Endre sofa in sage here" | `preview_in_room {product:"sofa-endre", colorway:"sage", anchor…}` (uses `get_selection` for "here") |
| "Make this room wheelchair friendly" | `set_accessibility_mode {enabled:true}` → `get_conflicts` → moves |
| "Set up for movie nights" | `arrange_room {style:"media"}` |
| "Undo that" | `undo {}` |
| "Add everything to the cart and give me the checkout" | `update_cart add ×n` → `get_checkout_link` |
