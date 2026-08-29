# Hearth WebMCP evals

`prompts.json` contains the 32 local/browser cases. `tools.json` is generated from the real Hearth registry by `scripts/evals/export-tools.ts` in the static shape expected by `webmcp-evals@0.0.4`.

The export intentionally includes all 36 definitions. A live design-mode page exposes 26 by default; preview, variants, checkout, and build tools appear only when their registry gates open. Static local evals cannot exercise those browser gates, so they receive the full schema set assumed by the prompt suite.

Run both required local backends with two runs per prompt:

```sh
pnpm evals
```

The script loads `.env` without printing it, probes the OpenAI Chat Completions compatibility used internally by the eval package (`gpt-5.6-sol`, then Terra/5.5 fallbacks), runs OpenAI and `claude-sonnet-5` through the Vercel AI SDK backend, and writes JSON/HTML reports plus `reports/SUMMARY.md`.

`webmcp-evals@0.0.4` hard-codes the OpenAI Chat Completions adapter. Current GPT-5.5/5.6 models reject function tools there unless reasoning effort is `none`, so the script starts a localhost-only compatibility proxy that injects that one field. This does not affect Hearth's production assistant, which uses the Responses API with high reasoning.

To additionally try the live browser loop in installed Chrome on port 3105:

```sh
RUN_BROWSER_EVALS=1 pnpm evals
```

Browser mode navigates to `?webmcp=polyfill`, which opts a non-native browser into Hearth's bundled WebMCP polyfill. The default app behavior remains native-only.

## Verified run

On 2026-08-29, local mode completed all 32 prompts twice with both `openai:gpt-5.6-sol` and `anthropic:claude-sonnet-5`; the raw JSON/HTML reports and consolidated findings are under `reports/`. The assistant route was also exercised against the live Responses API on port 3105 and streamed both a `get_scene_summary` call and the follow-up answer. The optional CLI browser eval was not run, so browser automation remains separately opt-in.

## Two metrics

- **Strict trajectory accuracy** (the CLI's own scoring, `SUMMARY.md`): positional match of the expected call tree. Optional context reads (`optional: true`, with realistic `mockOutput` from the real handlers) tolerate the reads our descriptions encourage, but any other extra call fails the run.
- **Key-call accuracy** (`scripts/evals/score.py` → `KEYCALL.md`): every required tool with its argument constraints appears in order somewhere in the trajectory; extra calls are ignored; `alternatives` on a required node accept an equivalent tool (e.g. `get_room_details` answers a free-span question as well as `measure`). This is the number we tune descriptions against.
