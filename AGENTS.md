<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Hearth — project conventions (read before writing any code)

Hearth is a human + agent shared interior-design studio: Next.js 16.3 (App Router, React Compiler) + React-Three-Fiber
+ Shopify Storefront API 2026-07 + **WebMCP** tools on `document.modelContext`. Production: https://hearth.yadneshsalvi.com.

## Contracts (the law; change the contract first, then code)
- `STYLE.md` — tokens, type, radius, shadow, 3D look, motion, forbidden list. Every UI/3D change is judged against it.
- `SCENE_SCHEMA.md` — the scene graph types, units (cm), coordinate frame (room-local, NW origin, x east, y south, rotation clockwise, 0 = front faces south), invariants.
- `TOOLS.md` — all 40 WebMCP tools: names, descriptions (≤ 500 chars), params (≤ 150), results (≤ 1.5K chars), groups/gates, registration lifecycle, receipts.
- `SHOPIFY.md` — product model, metafields, seeder, route handlers, cart/checkout (password-gated dev store).

## Layout
`app/` routes + route handlers (`app/api/**`, server-only, the only place secrets are read) · `src/tokens.ts` palette ·
`src/state/` zustand store (immer + zundo; every mutation is an action tagged `source: "human"|"agent"`) ·
`src/engine/` pure TS geometry/rules (no React, no three, 100 % unit-tested) · `src/tools/` WebMCP registry + handlers ·
`src/scene/` R3F renderer · `src/ui/` panels/chrome · `src/shopify/` client + snapshot · `src/floorplan/` plan-reader schema + client (`app/api/floorplan` is the vision route) · `src/assistant/` fallback agent ·
`scripts/` seeding/asset tooling (`tsx`) · `tests/` vitest (`tests/engine`, `tests/tools`) and Playwright (`tests/e2e`) ·
`data/` catalog source + snapshot · `public/assets/{glb,hdri,thumbs}` · `evals/` webmcp-evals prompts + reports.

## Rules
- TypeScript strict, no `any`, no `@ts-ignore`; `import type` for types; named exports; files ≤ ~400 lines.
- Client components declare `"use client"`; three/R3F code never runs on the server (dynamic import with `ssr: false` at the Studio boundary).
- Colors, radii, shadows, fonts only from `src/tokens.ts` / Tailwind `@theme` tokens in `app/globals.css` (no new hex, no default Tailwind palette, no dark mode).
- Engine functions are pure and deterministic (seedable); units are cm integers where possible.
- Tool handlers never throw: return the `{ok:false,error,detail}` envelope. Output ≤ 1500 chars (`tests/tools/budget.test.ts`).
- Secrets: only `process.env` in `app/api/**`, `scripts/**`, `src/shopify/server.ts`. Never log or echo `.env` values.
- Motion: chrome 180–320 ms ease-out; 3D springs; respect `prefers-reduced-motion`.
- Accessibility: every control focusable with a visible ochre focus ring and an accessible name; `Escape` closes overlays.
- Tests: `pnpm typecheck && pnpm lint && pnpm test` must pass before a task is reported done; UI tasks also ship 1440×900 screenshots.
- Writes are atomic (temp file + rename) because a dev server may be watching. Agents never `git commit`/`push`; the lead does.
- Ports: lead dev server 3000; builder agents 3101–3103; reviewers 3201+.

## Commands
`pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` (vitest) · `pnpm test:e2e` (playwright) ·
`pnpm seed` (Shopify seeder) · `pnpm evals` (webmcp-evals browser run).
