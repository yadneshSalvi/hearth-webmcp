# Key-call accuracy (required tools + argument constraints as an in-order subsequence; extra calls ignored)

- **openai:gpt-5.6-sol**: 62/64 runs (96.9%) — `evals/reports/2026-08-29-openai-gpt-5.6-sol/report-1787972177957.json`
  - FAIL `direct: measure wall`: matched 0/1 required; calls: measure
  - FAIL `direct: measure wall`: matched 0/1 required; calls: measure
- **anthropic:claude-sonnet-5**: 63/64 runs (98.4%) — `evals/reports/2026-08-29-anthropic-claude-sonnet-5/report-1787973875209.json`
  - FAIL `ambiguous: does it fit → measure`: matched 0/1 required; calls: get_room_details

| Eval | openai:gpt-5.6-sol | anthropic:claude-sonnet-5 |
|---|---:|---:|
| ambiguous: 'this' via selection | 2/2 | 2/2 |
| ambiguous: clear the room (confirm) | 2/2 | 2/2 |
| ambiguous: does it fit → measure | 2/2 | 1/2 |
| ambiguous: focus camera | 2/2 | 2/2 |
| ambiguous: warm it up (palette) | 2/2 | 2/2 |
| direct: accessibility | 2/2 | 2/2 |
| direct: add a window (build) | 2/2 | 2/2 |
| direct: add to cart | 2/2 | 2/2 |
| direct: arrange media | 2/2 | 2/2 |
| direct: cart | 2/2 | 2/2 |
| direct: colorway | 2/2 | 2/2 |
| direct: conflicts | 2/2 | 2/2 |
| direct: design report | 2/2 | 2/2 |
| direct: export board | 2/2 | 2/2 |
| direct: measure wall | 0/2 | 2/2 |
| direct: mode switch | 2/2 | 2/2 |
| direct: move with facing | 2/2 | 2/2 |
| direct: place with wall anchor | 2/2 | 2/2 |
| direct: preview in room | 2/2 | 2/2 |
| direct: product details | 2/2 | 2/2 |
| direct: remove | 2/2 | 2/2 |
| direct: room details | 2/2 | 2/2 |
| direct: save variant | 2/2 | 2/2 |
| direct: scene overview | 2/2 | 2/2 |
| direct: search under budget that fits | 2/2 | 2/2 |
| direct: selection | 2/2 | 2/2 |
| direct: time of day | 2/2 | 2/2 |
| direct: undo | 2/2 | 2/2 |
| multi: budget shopping | 2/2 | 2/2 |
| multi: checkout handoff | 2/2 | 2/2 |
| multi: compare two layouts | 2/2 | 2/2 |
| multi: wheelchair friendly | 2/2 | 2/2 |
