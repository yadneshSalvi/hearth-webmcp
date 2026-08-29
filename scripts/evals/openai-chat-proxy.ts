import { createServer } from "node:http";

const port = Number(process.env.EVAL_OPENAI_PROXY_PORT ?? "3199");
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required by the eval compatibility proxy.");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Not found" } }));
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  request.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 2_000_000) request.destroy(new Error("Eval request is too large."));
    else chunks.push(chunk);
  });
  request.on("end", () => {
    void (async () => {
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Invalid JSON" } }));
        return;
      }
      if (!isRecord(decoded)) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Invalid request" } }));
        return;
      }

      const upstreamAbort = new AbortController();
      request.once("aborted", () => upstreamAbort.abort());
      try {
        const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...decoded, reasoning_effort: "none" }),
          signal: upstreamAbort.signal,
        });
        response.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        });
        if (!upstream.body) {
          response.end();
          return;
        }
        const reader = upstream.body.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          response.write(Buffer.from(chunk.value));
        }
        response.end();
      } catch {
        if (response.headersSent) response.end();
        else {
          response.writeHead(502, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: { message: "OpenAI eval request failed" } }));
        }
      }
    })();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OpenAI eval compatibility proxy ready on 127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

