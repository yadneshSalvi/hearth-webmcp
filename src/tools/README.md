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
execution active → mark pending → result + receipt → 50 ms macrotask → sync
```

Each group owns one `AbortController`; stopping aborts all eight. Always-on groups are not aborted during normal syncing. A group that has just been aborted waits one microtask before re-registration, avoiding duplicate-name races in Chrome and the polyfill.

`ToolUi` supplies browser-side effects: `confirm(message)` resolves the confirmation modal, `focus(target)` moves the camera, `pulse(ids)` highlights objects, and optional `exportBoard({ roomId, title })` renders and downloads the PNG. `createConfirmGate` wires confirmation to `ui.pendingConfirm`; missing board export returns `unavailable`.

The fallback assistant calls `registry.execute(name, input, "assistant")`. Native WebMCP uses the same validator, confirmation gate, handler, shrink policy, and receipt path.

To add a tool:

1. Update `TOOLS.md` first.
2. Add a strict Zod input with parameter descriptions and a `defineTool` spec.
3. Export it from `handlers/index.ts` so `allTools` still contains each contract name once.
4. Add happy, invalid, not-found, receipt, lifecycle, and 1,500-character budget tests.
