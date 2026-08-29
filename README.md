# Hearth Studio — design a home *with* your agent

> A warm 3D interior-design studio that humans and AI agents share. Your agent sees the rooms, places furniture,
> checks clearances and door swings, shops a real Shopify catalog, and prepares checkout — through **36 WebMCP tools**
> registered on the page with `document.modelContext.registerTool`. You drag, it plans; both of you see the same scene.

**Live:** https://hearth.yadneshsalvi.com (mirror: https://hearth-wheat-ten.vercel.app) · **Video:** _coming_ · **Tools contract:** [TOOLS.md](TOOLS.md) · Licence: MIT

![Hearth in motion: an agent places furniture, arranges the room and compares two layouts](docs/hero.gif)

![Hearth Studio at golden hour: the living room in dollhouse view, catalog on the left, inspector and activity log on the right](docs/hero.png)

## Try it with your agent (2 minutes)

**ChatGPT desktop (recommended):** open the built-in browser (⌘⇧B), go to the live URL, and make sure *Settings → Browser →
Permissions → Enable site tools* is on (needs a GPT-5.6 Sol/Terra model). The address-bar arrow turns grey when Hearth's
tools are available. Then ask:

- "What rooms are in this home and what's in the living room?"
- "Find a sofa under $800 that fits the north wall and put it there facing the window."
- "Make the main bedroom wheelchair friendly and fix whatever gets in the way."
- "Set up the living room for movie nights, then show me the evening light."
- "Save this as *Before*, rearrange for conversation, save as *After*, and compare them."
- "Add everything in the living room to the cart and give me the checkout link."

**Chrome 152+ (no agent needed to see the tools):** enable `chrome://flags/#enable-webmcp-testing`, open the live URL, then
*DevTools → Application → WebMCP* lists every tool and lets you run them by hand. The **Model Context Tool Inspector**
extension works too. The production origin ships a WebMCP origin-trial token, so plain Chrome 149+ also exposes the tools.

**No WebMCP browser?** Click *Agent tools → Hearth Assistant*: an in-page agent (Chrome's WebMCP polyfill + `getTools()` /
`executeTool()`) drives the exact same tools, so the orb, receipts and undo behave identically. It runs under the same
guardrails as any agent: up to 60 tool calls per turn (`DEFAULT_MAX_CALLS_PER_TURN`), and destructive tools still open
the confirmation dialog.

## What the agent can do

26 tools are registered the moment the page loads; 10 more appear when they make sense (a preview exists, two layouts are
saved, the cart has lines, or you switch to Build mode). Every tool description is ≤ 500 characters, every result ≤ 1.5 K,
per Chrome's guidance — enforced in CI. Full contract: [TOOLS.md](TOOLS.md).

| Read the scene | Design | Shop | Build |
|---|---|---|---|
| `get_scene_summary`, `get_room_details`, `get_selection`, `measure`, `get_conflicts`, `get_design_report` | `place_furniture`, `move_furniture` (semantic anchors: *against the north wall, facing the window, next to the sofa*), `arrange_room`, `apply_palette`, `set_time_of_day`, `set_view`, `set_accessibility_mode`, `save_variant`, `load_variant`, `compare_variants`, `undo`, `clear_room` | `search_catalog`, `get_product`, `preview_in_room`, `confirm_preview`, `update_cart`, `get_cart`, `get_checkout_link` | `apply_template`, `create_room`, `update_room`, `add_opening`, `move_opening`, `remove_opening` |

```ts
// src/tools/registry.ts — one AbortController per tool group; groups appear/disappear with app state
document.modelContext.registerTool(
  {
    name: "place_furniture",
    title: "Place furniture",
    description: "Places a catalog product in a room as a new item. Position it with an anchor in words …",
    inputSchema, // zod → JSON Schema (draft-7), parameter descriptions ≤ 150 chars
    annotations: { readOnlyHint: false },
    async execute(input) {
      const parsed = schema.safeParse(input);           // validate strictly in code, loosely in schema
      if (!parsed.success) return { ok: false, error: "invalid", detail: firstIssue(parsed) };
      const placed = resolveAnchor(scene, room, product, parsed.data);   // engine does the geometry
      if (!placed.ok) return { ok: false, error: "blocked", detail: placed.detail, free_spans: placed.freeSpans };
      store.placeItem("agent", placed);                  // UI updates (orb flies, receipt logged) before we return
      return { ok: true, room, item, nudged_cm: placed.nudgedCm, conflicts: evaluateRoom(...), hint };
    },
  },
  { signal: groups.design.signal },
);
```

## What it looks like

| | |
|---|---|
| ![The Tools panel listing the WebMCP tools registered on the page with their schemas](docs/tools-panel.png) <br> **The tools, as an agent sees them** — 26 registered on load, each with its title, description and JSON Schema. | ![A door-swing conflict drawn as a dashed amber arc, with the inspector offering the fix in centimetres](docs/conflict.png) <br> **Conflicts are diagrams, not error text** — a dashed door-swing arc, and a fix in centimetres. |
| ![Accessibility mode on: 90 cm paths and a 150 cm turning circle drawn on the floor](docs/accessibility.png) <br> **Accessibility mode** — 90 cm paths and Ø150 cm turning circles, checked by the engine. | ![A ghost preview of a sofa in the room with the cart panel showing the line and subtotal](docs/shop-preview.png) <br> **Try before you buy** — `preview_in_room` ghosts the product; confirming it adds the Shopify line. |
| ![The exported design board: dollhouse render, plan, palette and the item list with prices](docs/board.png) <br> **`export_design_board`** — one 1600 × 1000 PNG with the render, the plan, the palette and the bill. | |

## How it's built

- **Engine** (`src/engine`, pure TypeScript, 180+ tests): room polygons → walls, footprints, free spans, door-swing arcs,
  clearance zones, A\* traffic paths, accessibility rules (90 cm paths, Ø150 cm turning circles), semantic anchors,
  four choreographed `arrange_room` styles, a design-report critic, and compact describers that keep every tool result
  under budget.
- **Store** (`src/state`): one zustand store with immer + zundo; every mutation is an action tagged `human | agent`, so
  the activity log is a shared history and undo works for both.
- **Registry** (`src/tools`): `defineTool` (zod → JSON Schema, budget assertions at definition time), group lifecycle
  with abort deferral (Chrome < 153 cancels in-flight executions on abort, so we never abort while a tool runs), an
  in-page confirmation gate for destructive tools, receipts, and a `toolchange` mirror that powers the Tools panel.
- **Renderer** (`src/scene`): React-Three-Fiber, orthographic plan/dollhouse camera, one lighting rig with four times of
  day, N8AO + ACES + restrained bloom, walls that fade when they block the view, CC0 low-poly furniture re-tinted
  through the palette, and the agent **orb** that flies to every action.
- **Shopify** (`src/shopify`, `app/api`): Storefront API 2026-07 (search, product, cart, checkout URL) behind route
  handlers; catalog metafields (`hearth.dims_cm`, `hearth.colorways`, …); a committed snapshot keeps browsing and
  previews working offline.
- **Quality**: `pnpm typecheck && pnpm lint && pnpm test` (58 files / 616 tests: engine, tools, budgets, UI), 30 Playwright
  e2e specs (drag, catalog drop, confirm dialogs, compare, board, assistant), a `webmcp-evals` prompt suite in
  [`evals/`](evals/), and Lighthouse on the production build (performance 98 · accessibility 96 · best practices 100).

  | Eval suite (32 prompts × 2 runs, `evals/prompts.json`) | gpt-5.6-sol | claude-sonnet-5 |
  |---|---:|---:|
  | Key-call accuracy — right tool, right arguments, in order (`evals/reports/KEYCALL.md`) | **64/64** | **64/64** |
  | Strict positional trajectory (the CLI's own metric; extra context reads count as misses) | 52/64 | 41/64 |

## Run it locally

```bash
pnpm install
cp .env.example .env            # Shopify tokens optional: the catalog snapshot and a local cart work offline
pnpm dev                        # http://localhost:3000
pnpm test                       # engine + tools + budgets
pnpm test:e2e                   # Playwright (loads the WebMCP polyfill)
```

The same 30 Playwright specs also run against the bundle a visitor gets. The suite reads studio
state back through `window.__hearth*`, which a production build only installs when it is asked to —
so build with the switch on, then point the suite at it:

```bash
NEXT_PUBLIC_HEARTH_E2E=1 pnpm build && pnpm start --port 3210
PLAYWRIGHT_BASE_URL=http://localhost:3210 pnpm test:e2e
```

A build without that variable exposes nothing; `?e2e=1` on the URL turns the handles on for one
page load instead, which is what the specs append so any production build can be driven.

## Credits

Furniture models: CC0 sets by Kenney, Quaternius, Kay Lousberg (KayKit) and poly.pizza contributors — see
[`public/assets/CREDITS.md`](public/assets/CREDITS.md). WebMCP polyfill © Google LLC, Apache-2.0. Fonts: Fraunces, Inter (OFL).
Built for the WebMCP Challenge, 2026.
