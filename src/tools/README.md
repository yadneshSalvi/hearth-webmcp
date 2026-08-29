# Hearth WebMCP tools

The registry exposes 36 static definitions and registers 26 always-on tools before first paint.

```text
start → core + design + shop + present
                 │ store gate selector changes
                 ├─ ghost ─────────────→ preview
                 ├─ 2 active variants ─→ variants
                 ├─ cart line ─────────→ checkout
                 └─ build mode ────────→ build

gate closes → AbortController.abort() → synchronous unregister
execution or confirmation active → mark pending → result + receipt → 50 ms macrotask → sync
```

Each group owns one `AbortController`; stopping aborts all eight. Always-on groups are not aborted during normal syncing. A group that has just been aborted waits one microtask before re-registration, avoiding duplicate-name races in Chrome and the polyfill.

`ToolUi` supplies browser-side effects: `confirm(message)` resolves `{ accepted, reason }`, `focus(target)` moves the camera, `pulse(ids)` highlights objects, and optional `exportBoard({ roomId, title })` renders and downloads the PNG. `createConfirmGate` wires confirmation to `ui.pendingConfirm`, reports decline/timeout/cancellation directly, and counts the whole dialog wait as an active execution; missing board export returns `unavailable`.

The fallback assistant calls `registry.execute(name, input, "assistant")`. The mirror path enforces the same dynamic group gates as native registration and returns `blocked` with the required gate-opening action. Native WebMCP uses the same validator, confirmation gate, handler, shrink policy, and receipt path.

Undo history has a label stack parallel to zundo's `pastStates`. Only actual scene transitions add labels: read-only receipts, cart linkage, active-room changes and selection/hover clicks do not consume undo steps. Undo/redo then restores those transient selections and reconciles links from the current cart so an older scene snapshot cannot overwrite them. Tool batches suppress duplicate agent action rows while preserving the scene label used by `undo`.

To add a tool:

1. Update `TOOLS.md` first.
2. Add a strict Zod input with parameter descriptions and a `defineTool` spec.
3. Export it from `handlers/index.ts` so `allTools` still contains each contract name once.
4. Add happy, invalid, not-found, receipt, lifecycle, and 1,500-character budget tests.
