import { layerPassed, type IntegrityIssue, type LayerResult } from "./checks";
import type { Classification } from "./classify";

export interface GateRun {
  classification: Classification;
  results: LayerResult[];
}

export interface Attempt {
  number: number;
  max: number;
}

const RULES = "Rules: do not skip, delete or weaken tests. Do not edit scripts/gate/** or gate.config.json.";

export function gatePassed(results: LayerResult[]): boolean {
  return results.every(layerPassed);
}

/** For example "api, shared (ui also runs because shared changed)". */
export function describeLayers({ touched, sharedFiles, layersToRun }: Classification): string {
  const labels = [...touched, ...(sharedFiles.length > 0 ? ["shared"] : [])];
  const extra = layersToRun.filter((layer) => !touched.includes(layer));
  if (extra.length === 0) return labels.join(", ");
  return `${labels.join(", ")} (${extra.join(", ")} also ${extra.length === 1 ? "runs" : "run"} because shared changed)`;
}

/** The report Claude gets when the gate blocks it. Without an attempt, it's a manual run. */
export function formatFailureReport(run: GateRun, attempt?: Attempt): string {
  const header = attempt ? `GATE FAILED (attempt ${attempt.number} of ${attempt.max})` : "GATE FAILED";
  return [header, "", `Layers touched: ${describeLayers(run.classification)}`, "", ...run.results.flatMap(formatLayer), RULES].join(
    "\n",
  );
}

function formatLayer({ layer, subagent, tests, missingTests, integrity }: LayerResult): string[] {
  const lines: string[] = [];

  if (tests.passed) {
    lines.push(`[${layer}] tests passed`, "");
  } else {
    lines.push(
      `[${layer}] tests FAILED`,
      ...tests.failures.map((failure) => `  - ${failure}`),
      `  Action: use the ${subagent} subagent to investigate and fix. Fix the code, not the test,`,
      "  unless the test is wrong. Explain if you change a test.",
      "",
    );
  }

  if (missingTests.length > 0) {
    lines.push(
      `[${layer}] missing tests`,
      ...missingTests.map(({ source, expected }) => `  - ${source} has no ${expected}`),
      `  Action: use the ${subagent} subagent to write tests for ${missingTests.length === 1 ? "it" : "them"}.`,
      "",
    );
  }

  if (integrity.length > 0) {
    lines.push(
      `[${layer}] test integrity`,
      ...integrity.map((issue) => `  - ${describeIssue(issue)}`),
      "  Action: restore the tests. Skipped, deleted or weakened tests never pass the gate.",
      "",
    );
  }

  return lines;
}

function describeIssue(issue: IntegrityIssue): string {
  switch (issue.kind) {
    case "deleted":
      return `${issue.file} was deleted`;
    case "skips-added":
      return `${issue.file} adds .skip/.only/.todo/.fails (${issue.before} → ${issue.after})`;
    case "assertions-removed":
      return `${issue.file} has fewer assertions (${issue.before} → ${issue.after})`;
  }
}

/** Shown to you in the terminal when the gate lets Claude stop. */
export function formatPassMessage(run: GateRun): string {
  const counts = run.results.map(({ layer, tests }) =>
    tests.passedCount === undefined ? `${layer} passed` : `${layer} ${tests.passedCount} passed`,
  );
  return `✓ Gate passed. Layers touched: ${describeLayers(run.classification)}. Tests: ${counts.join(", ")}.`;
}

/** Shown to you in the terminal when the gate stops retrying and lets Claude stop anyway. */
export function formatHandoffMessage(run: GateRun, attempt: Attempt, reportFile: string): string {
  const problems = run.results.flatMap(({ layer, tests, missingTests, integrity }) => [
    ...(tests.passed ? [] : [`${layer} tests failing`]),
    ...(missingTests.length > 0 ? [`${layer} missing tests`] : []),
    ...(integrity.length > 0 ? [`${layer} test integrity`] : []),
  ]);
  return (
    `✗ Gate failed ${attempt.number} times in a row (limit ${attempt.max}): ${problems.join(", ")}. ` +
    `Claude was allowed to stop. Needs human review, see ${reportFile}`
  );
}
