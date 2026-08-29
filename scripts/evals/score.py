#!/usr/bin/env python3
"""Key-call scoring for webmcp-evals reports.

The CLI's trajectory matcher is positional: any context read or verification call the model adds
fails the run. This scorer asks the question we care about for description tuning — did the agent
call every REQUIRED tool (non-optional node) with arguments satisfying the constraints, in order,
anywhere in its trajectory? Extra calls are ignored. Writes evals/reports/KEYCALL.md."""
import glob, json, os, re, sys

def latest(pattern):
    files = sorted(glob.glob(pattern), key=os.path.getmtime)
    return files[-1] if files else None

def match_constraint(expected, actual):
    if isinstance(expected, dict) and expected and all(k.startswith("$") for k in expected):
        for op, val in expected.items():
            if op == "$pattern":
                m = re.match(r"^\(\?([a-z]+)\)", val); flags = 0; pat = val
                if m:
                    pat = val[m.end():]
                    if "i" in m.group(1): flags |= re.I
                if actual is None or re.search(pat, str(actual), flags) is None: return False
            elif op == "$contains":
                if actual is None or str(val) not in str(actual): return False
            elif op == "$type":
                if val == "string" and not isinstance(actual, str): return False
                if val == "number" and not isinstance(actual, (int, float)): return False
            elif op in ("$lte", "$gte", "$lt", "$gt"):
                try: a = float(actual)
                except (TypeError, ValueError): return False
                if op == "$lte" and not a <= val: return False
                if op == "$gte" and not a >= val: return False
                if op == "$lt" and not a < val: return False
                if op == "$gt" and not a > val: return False
        return True
    if isinstance(expected, dict):
        if not isinstance(actual, dict): return False
        return all(k in actual and match_constraint(v, actual[k]) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(match_constraint(e, a) for e, a in zip(expected, actual))
    return expected == actual

def required_nodes(nodes):
    out = []
    for n in nodes:
        if "ordered" in n: out += required_nodes(n["ordered"])
        elif "unordered" in n: out += required_nodes(n["unordered"])
        elif not n.get("optional"): out.append(n)
    return out

def node_matches(node, name, args):
    options = [node] + list(node.get("alternatives", []))
    return any(o["functionName"] == name and match_constraint(o.get("arguments", {}), args or {}) for o in options)

def subsequence_ok(required, calls):
    i = 0
    for name, args in calls:
        if i < len(required) and node_matches(required[i], name, args):
            i += 1
    return i == len(required), i

def score(report_path):
    d = json.load(open(report_path))
    runs = {}
    for row in d["results"]["results"]:
        key = (row["test"]["name"], row.get("runIndex", 1))
        if key in runs: continue
        calls = []
        for step in row.get("trajectory", []):
            for tc in step.get("toolCalls", []) or []:
                calls.append((tc.get("toolName"), tc.get("input")))
        runs[key] = (required_nodes(row["test"].get("expectedCall", [])), calls)
    per_eval = {}
    for (name, run), (req, calls) in runs.items():
        ok, hit = subsequence_ok(req, calls)
        per_eval.setdefault(name, []).append((ok, hit, len(req), calls))
    total = sum(len(v) for v in per_eval.values()); passed = sum(1 for v in per_eval.values() for ok, *_ in v if ok)
    return per_eval, passed, total

def main():
    backends = [("openai:gpt-5.6-sol", "evals/reports/2026-*-openai-gpt-5.6-sol/report-*.json"), ("anthropic:claude-sonnet-5", "evals/reports/2026-*-anthropic-claude-sonnet-5/report-*.json")]
    lines = ["# Key-call accuracy (required tools + argument constraints as an in-order subsequence; extra calls ignored)", ""]
    table = {}
    header = ["| Eval |"]
    for label, pattern in backends:
        path = latest(pattern)
        if not path: continue
        per_eval, passed, total = score(path)
        lines.append(f"- **{label}**: {passed}/{total} runs ({100*passed/total:.1f}%) — `{path}`")
        header.append(f" {label} |")
        for name, runs in per_eval.items():
            table.setdefault(name, {})[label] = f"{sum(1 for ok,*_ in runs if ok)}/{len(runs)}"
            for ok, hit, need, calls in runs:
                if not ok:
                    lines.append(f"  - FAIL `{name}`: matched {hit}/{need} required; calls: " + " → ".join(f"{n}" for n, _ in calls)[:300])
    lines += ["", "".join(header), "|---|" + "---:|" * (len(header) - 1)]
    for name in sorted(table):
        lines.append(f"| {name} |" + "".join(f" {table[name].get(l, '-')} |" for l, _ in backends))
    open("evals/reports/KEYCALL.md", "w").write("\n".join(lines) + "\n")
    print("\n".join(lines[:4]))

if __name__ == "__main__":
    main()
