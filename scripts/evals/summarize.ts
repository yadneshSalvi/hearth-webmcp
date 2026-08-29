import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

interface EvalResult {
  test: {
    name?: string;
    messages?: Array<{ content?: string }>;
    expectedCall?: Array<{ functionName?: string; arguments?: unknown }> | null;
  };
  response?: { functionName?: string; args?: unknown } | null;
  outcome?: string;
  runIndex?: number;
}

interface Report {
  config?: { model?: string };
  results?: {
    results?: EvalResult[];
    passCount?: number;
    failCount?: number;
    errorCount?: number;
  };
}

interface LoadedReport {
  label: string;
  path: string;
  rows: EvalResult[];
  stepPasses: number;
}

function safeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function compact(value: unknown): string {
  if (value === undefined) return "{}";
  const serialised = JSON.stringify(value);
  if (!serialised) return "{}";
  return serialised.length <= 260 ? serialised : `${serialised.slice(0, 257)}…`;
}

async function latestJson(directory: string): Promise<string> {
  const entries = (await readdir(directory))
    .filter((name) => /^report-\d+\.json$/.test(name))
    .sort();
  const latest = entries.at(-1);
  if (!latest) throw new Error(`No JSON eval report found in ${directory}.`);
  return join(directory, latest);
}

async function load(directory: string): Promise<LoadedReport> {
  const path = await latestJson(directory);
  const report = JSON.parse(await readFile(path, "utf8")) as Report;
  const rows = report.results?.results ?? [];
  return {
    label: report.config?.model ?? basename(directory),
    path,
    rows,
    stepPasses: rows.filter((row) => row.outcome === "pass").length,
  };
}

function runGroups(report: LoadedReport): Map<string, EvalResult[]> {
  const groups = new Map<string, EvalResult[]>();
  for (const row of report.rows) {
    const name = row.test.name ?? "Unnamed eval";
    const key = `${name}\u0000${row.runIndex ?? 1}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function evalStats(report: LoadedReport): Map<string, { passed: number; total: number }> {
  const stats = new Map<string, { passed: number; total: number }>();
  for (const [key, rows] of runGroups(report)) {
    const name = key.split("\u0000")[0] ?? "Unnamed eval";
    const current = stats.get(name) ?? { passed: 0, total: 0 };
    current.total += 1;
    if (rows.every((row) => row.outcome === "pass")) current.passed += 1;
    stats.set(name, current);
  }
  return stats;
}

function accuracy(report: LoadedReport): { passed: number; total: number; percent: number } {
  const groups = [...runGroups(report).values()];
  const passed = groups.filter((rows) => rows.every((row) => row.outcome === "pass")).length;
  return { passed, total: groups.length, percent: groups.length === 0 ? 0 : (passed / groups.length) * 100 };
}

function hypothesis(rows: EvalResult[]): string {
  const expected = rows.flatMap((row) => row.test.expectedCall ?? []).map((call) => call.functionName).filter(Boolean);
  const actual = rows.map((row) => row.response?.functionName).filter(Boolean);
  if (actual.length === 0) return "The model stopped without a tool; the 36-tool selection may have weakened tool use.";
  if (expected.every((name) => actual.includes(name))) {
    return actual[0] === "get_scene_summary" && expected[0] !== "get_scene_summary"
      ? "The expected call occurred after the contract-recommended scene-summary lookup, but the strict trajectory matcher rejects the extra call."
      : "The expected calls occurred, but the strict trajectory matcher rejects extra preparatory or follow-up calls.";
  }
  if (expected.some((name) => actual.includes(name))) {
    return "The model partially completed the trajectory; tool ordering or the step limit prevented an exact match.";
  }
  if (expected.length === actual.length && expected.some((name, index) => name === actual[index])) {
    return "The function partly matched, but schema guidance may be too loose or missing an argument cue.";
  }
  return "Overlapping tool intents or description wording likely steered selection to a different function.";
}

function calls(rows: EvalResult[], kind: "expected" | "actual"): string {
  const values = kind === "expected"
    ? rows.flatMap((row) => row.test.expectedCall ?? []).map((call) => `${call.functionName ?? "tool"} ${compact(call.arguments)}`)
    : rows.flatMap((row) => row.response?.functionName ? [`${row.response.functionName} ${compact(row.response.args)}`] : []);
  return values.length > 0 ? values.map((value) => `\`${safeCell(value)}\``).join(" → ") : "no tool call";
}

function failures(report: LoadedReport): string[] {
  const lines: string[] = [];
  for (const [key, rows] of runGroups(report)) {
    if (rows.every((row) => row.outcome === "pass")) continue;
    const first = rows[0];
    if (!first) continue;
    const name = key.split("\u0000")[0] ?? "Unnamed eval";
    const prompt = first.test.messages?.map((message) => message.content).filter(Boolean).join(" ") ?? name;
    lines.push(
      `- **${safeCell(name)}** (run ${first.runIndex ?? 1}): “${safeCell(prompt)}” — `
      + `expected ${calls(rows, "expected")}; actual ${calls(rows, "actual")}. ${hypothesis(rows)}`,
    );
  }
  return lines;
}

async function writeSummary(reports: LoadedReport[]): Promise<void> {
  const allNames = [...new Set(reports.flatMap((report) => [...evalStats(report).keys()]))].sort();
  const lines = [
    "# Hearth WebMCP eval summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Accuracy",
    "",
    "| Backend / model | Eval-run accuracy | Step accuracy | Report |",
    "|---|---:|---:|---|",
  ];
  for (const report of reports) {
    const score = accuracy(report);
    const stepPercent = report.rows.length === 0 ? 0 : (report.stepPasses / report.rows.length) * 100;
    lines.push(`| ${safeCell(report.label)} | ${score.passed}/${score.total} (${score.percent.toFixed(1)}%) | ${report.stepPasses}/${report.rows.length} (${stepPercent.toFixed(1)}%) | ${safeCell(relative(process.cwd(), report.path))} |`);
  }
  lines.push("", "## Per-eval results", "");
  lines.push(`| Eval | ${reports.map((report) => safeCell(report.label)).join(" | ")} |`);
  lines.push(`|---|${reports.map(() => "---:").join("|")}|`);
  const stats = reports.map(evalStats);
  for (const name of allNames) {
    const cells = stats.map((modelStats) => {
      const value = modelStats.get(name) ?? { passed: 0, total: 0 };
      return `${value.passed}/${value.total} ${value.passed === value.total && value.total > 0 ? "PASS" : "FAIL"}`;
    });
    lines.push(`| ${safeCell(name)} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Eval findings", "");
  for (const report of reports) {
    const failed = failures(report);
    lines.push(`### ${report.label}`, "");
    lines.push(...(failed.length > 0 ? failed : ["No failing prompts."]), "");
  }
  lines.push(
    "## Method note",
    "",
    "`webmcp-evals@0.0.4` uses a strict trajectory matcher: a contract-recommended context lookup before the expected direct call, or useful verification after it, is counted as a failure. Accuracy above reports both complete eval-run matches and individual expected-step matches.",
    "",
  );

  const output = resolve(process.cwd(), "evals/reports/SUMMARY.md");
  const temporary = join(dirname(output), `.summary-${process.pid}.tmp`);
  try {
    await writeFile(temporary, `${lines.join("\n")}\n`, "utf8");
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  console.log(`Wrote ${output}`);
}

async function main(): Promise<void> {
  const directories = process.argv.slice(2).map((directory) => resolve(process.cwd(), directory));
  if (directories.length === 0) throw new Error("Pass at least one eval report directory.");
  await writeSummary(await Promise.all(directories.map(load)));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Eval summary generation failed.");
  process.exitCode = 1;
});
