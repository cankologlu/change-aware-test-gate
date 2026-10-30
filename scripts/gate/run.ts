/**
 * Change-aware test gate.
 *
 * Claude Code runs this as a Stop hook (see .claude/settings.json). It reads the hook input
 * from stdin, works out which layers the current change touches, runs only their checks, and
 * then either lets Claude stop or blocks it with a report saying what to fix.
 *
 * `npm run gate` runs the same checks by hand (`--manual`): it prints the report and leaves
 * the retry counter alone.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { runChecks, type LayerResult } from "./checks";
import { classify } from "./classify";
import { loadConfig } from "./config";
import { collectChanges, diffPatch, repoRoot, resolveBase } from "./diff";
import { formatFailureReport, formatHandoffMessage, formatPassMessage, gatePassed, type GateRun } from "./report";
import { loadState, recordRun, saveState } from "./state";

/** The Stop hook input fields the gate uses. Claude Code sends more. */
interface StopHookInput {
  session_id?: string;
  cwd?: string;
  /** True when Claude is already continuing because a Stop hook blocked it. */
  stop_hook_active?: boolean;
}

/** What the gate prints for Claude Code. Printing nothing lets Claude stop silently. */
type HookOutput = { decision: "block"; reason: string } | { systemMessage: string };

async function main(): Promise<void> {
  const manual = process.argv.includes("--manual");
  const input = manual ? {} : parseInput(await readStdin());

  // `cwd` follows Claude into worktrees, so the gate checks the checkout Claude is working in.
  const root = repoRoot(input.cwd ?? process.cwd());
  const config = loadConfig(root);
  const base = resolveBase(root, config.baseRef);
  const classification = classify(collectChanges(root, base), config);
  const gateDir = join(root, ".gate");

  if (classification.layersToRun.length === 0) {
    if (manual) console.log("Gate: no changes in any layer, nothing to check.");
    return; // Nothing to check: let Claude stop.
  }

  mkdirSync(join(gateDir, "reports"), { recursive: true });
  writeFileSync(join(gateDir, "last-diff.patch"), diffPatch(root, base));

  const run: GateRun = { classification, results: await runChecks(root, base, config, classification) };
  const passed = gatePassed(run.results);

  if (manual) {
    const summary = passed ? formatPassMessage(run) : formatFailureReport(run);
    const reportFile = writeReport(root, passed ? "pass" : "fail", summary, run.results);
    console.log(`${summary}\n\nFull report: ${reportFile}`);
    process.exitCode = passed ? 0 : 1;
    return;
  }

  const statePath = join(gateDir, "state.json");
  const { state, decision } = recordRun(
    loadState(statePath),
    input.session_id ?? "unknown",
    { passed, newTurn: !input.stop_hook_active },
    config.maxRetries,
  );
  saveState(statePath, state);

  if (decision.action === "allow") {
    const summary = formatPassMessage(run);
    writeReport(root, "pass", summary, run.results);
    respond({ systemMessage: summary });
    return;
  }

  const attempt = { number: decision.attempt, max: config.maxRetries };
  const report = formatFailureReport(run, attempt);

  if (decision.action === "block") {
    const reportFile = writeReport(root, "fail", report, run.results);
    respond({ decision: "block", reason: `${report}\n\nFull test output: ${reportFile}` });
    return;
  }

  // Retry limit reached: let Claude stop and hand over to a human instead of looping forever.
  const reportFile = writeReport(root, "needs-human", `${report}\n\nNEEDS HUMAN REVIEW`, run.results);
  respond({ systemMessage: formatHandoffMessage(run, attempt, reportFile) });
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseInput(text: string): StopHookInput {
  try {
    return text.trim() ? (JSON.parse(text) as StopHookInput) : {};
  } catch {
    return {};
  }
}

/** Claude Code reads the hook's stdout as JSON only if it holds a single JSON object. */
function respond(output: HookOutput): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

/** Writes a report to .gate/reports/ and returns its repo-relative path. */
function writeReport(root: string, status: "pass" | "fail" | "needs-human", summary: string, results: LayerResult[]): string {
  const file = join(root, ".gate", "reports", `${new Date().toISOString().replace(/[:.]/g, "-")}-${status}.md`);
  const outputs = results.flatMap(({ layer, tests }) => [
    `## ${layer} test output`,
    "",
    "```text",
    tests.output.trimEnd().split("\n").slice(-200).join("\n"),
    "```",
    "",
  ]);
  writeFileSync(file, [`# Gate report: ${status}`, "", "```text", summary, "```", "", ...outputs].join("\n"));
  return relative(root, file);
}

main().catch((err: unknown) => {
  // Exit code 1 is a non-blocking hook error: Claude Code shows it to you and lets Claude stop.
  // A broken gate shouldn't trap Claude in a loop it isn't allowed to fix.
  console.error(`Gate error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
