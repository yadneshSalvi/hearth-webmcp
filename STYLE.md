# STYLE.md — Hearth art direction (the law for every UI and 3D change)

**Mood:** warm architectural miniature. Sims-dollhouse charm with Kinfolk-magazine restraint.
Every frame should look composed, calm, and expensive. Consistency beats realism, always.

## 1. Tokens — the only source of color, type, radius, shadow (`src/tokens.ts`)

| Token | Value | Use |
|---|---|---|
| `canvas.top` → `canvas.bottom` | `#F7F3EC` → `#EFE7DB` | page/canvas background gradient (never black, never pure white) |
| `plaster` | `#F4EFE6` | walls, panel surfaces |
| `oak` | `#D9C4A3` | floors (subtle procedural plank stripes ±3% luminance) |
| `paleOak` | `#E6D8BF` | pale-oak floors, Nordic and sage-linen palettes |
| `stone` | `#D8D3CA` | stone floors and the base for derived terrazzo |
| `terracotta` | `#C46A4A` | primary accent, orb, primary buttons |
| `sage` | `#8A9B7C` | success, plants, secondary chips |
| `ochre` | `#C9A44C` | focus rings, highlights, lamps' warm emissive |
| `dustyBlue` | `#7E93A8` | informational, links, plan-view lines |
| `plum` | `#8A6A7D` | tertiary accent (variants, compare) |
| `charcoal` | `#3E3A36` | text, icons, hairlines at 12–16% alpha |
| `amber` (semantic) | `#D9973B` | conflicts/warnings — max 0.6 opacity, never alarming |
| `rose` (semantic) | `#C25E5E` | violations — pulsing floor zones at ≤ 0.6 opacity |
| `ink.muted` | `charcoal @ 74%` | secondary text (≥ 4.5:1 on plaster *and* on glass over oak) |
| `ink.faint` | `charcoal @ 52%` | tertiary text: units, counts, disabled hints |
| `hairline` | `charcoal @ 14%` | 1 px rules and borders |

These six accents + two semantics are the **only** saturated colors allowed anywhere (UI or 3D
materials). No Tailwind default palette. No new hex values without editing `tokens.ts`.

**Type:** Fraunces (display serif; headings, numerals, prices, measurements) + Inter (UI).
Small-caps labels use Inter 11–12 px, `letter-spacing: 0.12em`, uppercase ("LIVING ROOM · 24.5 M²").
Numerals in receipts/measurements use Fraunces with `font-variant-numeric: tabular-nums`.

**Radius:** 16 px panels/cards · 10 px chips/inputs · 999 px pills.
**Shadows:** large, soft, warm-tinted, low opacity: `0 18px 48px -18px rgba(62,58,54,.28), 0 2px 6px rgba(62,58,54,.06)`.
**Glass:** floating panels are `plaster @ 88%` with `backdrop-filter: blur(14px)` over the canvas.
**Spacing rhythm:** 4 px base; panels pad 16/20; card gaps 12; section gaps 24.

## 2. The 3D look (build once in `src/scene/LightingRig.tsx`; nobody adds lights elsewhere)

- **Orthographic camera**, isometric pitch ≈ 35.264°, yaw snaps to 45° increments with a
  600 ms eased tween. Two views only: **Plan** (top-down) and **Dollhouse**. No free-fly camera.
- **Lighting rig:** (1) warm directional key with soft shadows (drei `SoftShadows`), (2) subtle
  neutral HDRI environment at low intensity, (3) **N8AO** ambient occlusion, (4) ACES filmic tone
  mapping + slight vignette + restrained bloom (emissive lamps only).
- **Time of day** is content: morning / noon / golden / evening tween sun angle, color,
  environment intensity and background gradient over ~2 s; in evening every lamp blooms.
- **Walls auto-fade** when between camera and room interior (per-wall opacity from camera-facing dot).
- **Materials:** matte clay — `meshStandardMaterial`, roughness 0.85–0.95, metalness 0. All GLBs
  are **re-tinted through the palette** on load (albedo → nearest palette family) so 70 assets read
  as one designed set.
- Ghost previews: same mesh, `opacity 0.45`, dustyBlue tint, no shadow.

## 3. Motion

- Chrome (2D): 180–320 ms, ease-out; enters translate 6–10 px + fade; never bounce UI.
- 3D placement: drop from +40 cm, spring settle, 1.03 scale bounce, soft dust-ring pulse on floor.
  Removal: shrink + fade. Moves: spring glide with a gentle vertical arc.
- **`arrange_room` is choreographed:** items glide with 60 ms stagger, longest distance last.
- **Agent orb:** small warm emissive sphere (bloom-lit) that flies (500 ms spring) to the site of
  every tool action, hovers with a label chip, idles in a corner otherwise.
- Conflicts render as diagrams: thin dashed amber door-swing arcs; softly pulsing rose floor
  zones; animated dotted traffic lines flowing between doorways. Blueprint-elegant, never error-red.
- `prefers-reduced-motion`: choreography → cross-fades; orb static; no pulses.

## 4. UI composition rules

- Canvas is full-bleed; panels float over it (see `plans` layout): Catalog left, Inspector /
  Activity / Cart right, mode + room chips top-left, view/time/undo/export top-right, prompt
  pill bar bottom-center, status chip bottom-right.
- Every control has a visible focus ring (`ochre` 2 px), an accessible name, and a hover state.
- Empty, loading, error states are designed (skeletons in `plaster`, copy in Fraunces italic).
- Text: sentence case; concise; measurements always with units ("240 cm", "$1,240").

## 5. Forbidden

Default Tailwind blues/purples · `shadow-md`/default shadows · emoji in UI · any font besides
Fraunces/Inter · new hex colors · any `pointLight`/`spotLight` outside `LightingRig` · stock toast
library styling · alert-red · full-black text (`#000`) · drop-in component libraries with their own
look (build ours) · dark mode (single warm theme; paint colors explicitly).

## 6. Sign-off

Every UI task ships 1440×900 screenshots (plus 1280 and 1920 checks). Reviewers judge screenshots
against this file first, code second. A change that looks off is a defect even if it works.
