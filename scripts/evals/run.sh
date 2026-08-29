#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env; OPENAI_API_KEY and ANTHROPIC_API_KEY are required." >&2
  exit 1
fi

set -a
source ./.env
set +a

if [[ -z "${OPENAI_API_KEY:-}" || -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "Both OPENAI_API_KEY and ANTHROPIC_API_KEY must be configured." >&2
  exit 1
fi

pnpm exec tsx scripts/evals/export-tools.ts

PROBE_DIR="$(mktemp -d)"
PROXY_PID=""
cleanup() {
  if [[ -n "$PROXY_PID" ]]; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
  rm -rf "$PROBE_DIR"
}
trap cleanup EXIT

probe_openai_model() {
  local candidate="$1"
  local status
  status="$(curl --silent --show-error --max-time 60 \
    --output "$PROBE_DIR/openai-response.json" \
    --write-out '%{http_code}' \
    https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"$candidate\",\"messages\":[{\"role\":\"user\",\"content\":\"Call ping.\"}],\"reasoning_effort\":\"none\",\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"ping\",\"description\":\"Ping.\",\"parameters\":{\"type\":\"object\",\"properties\":{}}}}],\"tool_choice\":\"auto\",\"max_completion_tokens\":64}")"
  [[ "$status" == "200" ]]
}

OPENAI_MODEL=""
for candidate in gpt-5.6-sol gpt-5.6-terra gpt-5.5; do
  if probe_openai_model "$candidate"; then
    OPENAI_MODEL="$candidate"
    break
  fi
done
if [[ -z "$OPENAI_MODEL" ]]; then
  echo "None of gpt-5.6-sol, gpt-5.6-terra, or gpt-5.5 was accepted by Chat Completions." >&2
  exit 1
fi
echo "OpenAI eval model: $OPENAI_MODEL"

EVAL_OPENAI_PROXY_PORT="${EVAL_OPENAI_PROXY_PORT:-3199}"
export EVAL_OPENAI_PROXY_PORT
pnpm exec tsx scripts/evals/openai-chat-proxy.ts > "$PROBE_DIR/openai-proxy.log" 2>&1 &
PROXY_PID=$!
for _attempt in {1..50}; do
  if curl --silent --fail --output /dev/null "http://127.0.0.1:${EVAL_OPENAI_PROXY_PORT}/health"; then break; fi
  sleep 0.2
done
if ! curl --silent --fail --output /dev/null "http://127.0.0.1:${EVAL_OPENAI_PROXY_PORT}/health"; then
  echo "OpenAI eval compatibility proxy did not start." >&2
  exit 1
fi

RUN_DATE="$(date +%Y-%m-%d)"
OPENAI_DIR="evals/reports/${RUN_DATE}-openai-${OPENAI_MODEL}"
ANTHROPIC_MODEL="claude-sonnet-5"
ANTHROPIC_DIR="evals/reports/${RUN_DATE}-anthropic-${ANTHROPIC_MODEL}"
mkdir -p "$OPENAI_DIR" "$ANTHROPIC_DIR"

run_local() {
  local model="$1"
  local output_dir="$2"
  npx -y webmcp-evals@0.0.4 \
    --backend vercel \
    --model "$model" \
    --runs 2 \
    --max-steps 500 \
    --reporter console json html \
    --output-dir "$output_dir" \
    local --tools evals/tools.json --evals evals/prompts.json
}

OPENAI_BASE_URL="http://127.0.0.1:${EVAL_OPENAI_PROXY_PORT}/v1" run_local "openai:${OPENAI_MODEL}" "$OPENAI_DIR"
kill "$PROXY_PID" 2>/dev/null || true
wait "$PROXY_PID" 2>/dev/null || true
PROXY_PID=""
run_local "anthropic:${ANTHROPIC_MODEL}" "$ANTHROPIC_DIR"
pnpm exec tsx scripts/evals/summarize.ts "$OPENAI_DIR" "$ANTHROPIC_DIR"

if [[ "${RUN_BROWSER_EVALS:-0}" == "1" ]]; then
  BROWSER_DIR="evals/reports/${RUN_DATE}-browser-${OPENAI_MODEL}"
  mkdir -p "$BROWSER_DIR"
  pnpm dev -p 3105 > "$BROWSER_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  stop_server() {
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  }
  trap 'stop_server; cleanup' EXIT
  for _attempt in {1..60}; do
    if curl --silent --fail --output /dev/null "http://localhost:3105/?webmcp=polyfill"; then break; fi
    sleep 1
  done
  npx -y webmcp-evals@0.0.4 \
    --backend vercel \
    --model "openai:${OPENAI_MODEL}" \
    --runs 1 \
    --max-steps 500 \
    --reporter console json html \
    --output-dir "$BROWSER_DIR" \
    --chrome-channel chrome \
    browser --url "http://localhost:3105/?webmcp=polyfill" --evals evals/prompts.json
  stop_server
  trap cleanup EXIT
fi
