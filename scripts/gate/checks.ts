import { exec } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { Classification } from "./classify";
import { matchesAny, type GateConfig, type LayerConfig } from "./config";
import { listFiles, readAtBase, readCurrent, type FileChange } from "./diff";

const execAsync = promisify(exec);

// ── Tests ──────────────────────────────────────────────────────────────────

export interface TestRun {
  passed: boolean;
  /** One line per failing test, e.g. "PATCH /tasks/:id › toggles done: expected 200, got 404". */
  failures: string[];
  /** How many tests passed, when the output says so. */
  passedCount?: number;
  output: string;
}

export async function runTests(command: string, cwd: string, timeoutMs = 4 * 60_000): Promise<TestRun> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    const output = stripAnsi(stdout + stderr);
    return { passed: true, failures: [], passedCount: countPassed(output), output };
  } catch (err) {
    const { stdout = "", stderr = "", killed } = err as { stdout?: string; stderr?: string; killed?: boolean };
    let output = stripAnsi(stdout + stderr);
    if (killed) output += `\nStopped after ${timeoutMs / 1000}s without finishing.`;
    return { passed: false, failures: summarizeFailures(output), output };
  }
}

/** Turns test runner output into one short line per failing test. */
export function summarizeFailures(output: string, limit = 8): string[] {
  const lines = output.split("\n");
  const failures: string[] = [];

  // Vitest prints each failure as " FAIL  file > suite > test" with the error on the next line.
  lines.forEach((line, i) => {
    const match = /^\s*FAIL\s+(.+?)\s*$/.exec(line);
    if (!match) return;
    const [file, ...names] = match[1]!.replace(/\s*\[.*\]$/, "").split(" > ");
    const message = lines.slice(i + 1).find((next) => next.trim() !== "") ?? "";
    failures.push(`${names.length > 0 ? names.join(" › ") : file}: ${tidyMessage(message.trim())}`);
  });

  if (failures.length === 0) {
    // Another runner, or Vitest crashed before running tests: show the lines that look like errors.
    const meaningful = lines.map((line) => line.trim()).filter((line) => line && !/^npm (error|ERR!)/.test(line));
    const errors = meaningful.filter((line) => /\b(error|fail(ed|ure)?|cannot|not found|expected)\b/i.test(line));
    return (errors.length > 0 ? errors : meaningful.slice(-limit)).slice(0, limit);
  }

  const unique = [...new Set(failures)];
  return unique.length > limit ? [...unique.slice(0, limit), `…and ${unique.length - limit} more`] : unique;
}

function tidyMessage(message: string): string {
  const text = message.replace(/^(?:AssertionError|Error):\s*/, "").replace(/\s*\/\/ Object\.is equality$/, "");
  // Vitest says "expected 404 to be 200"; for simple values, put the expected value first.
  const simple = /^expected (\S+) to (?:be|equal) (\S+)$/.exec(text);
  return simple ? `expected ${simple[2]}, got ${simple[1]}` : text;
}

function countPassed(output: string): number | undefined {
  const match = /Tests\s+(\d+) passed/.exec(output);
  return match ? Number(match[1]) : undefined;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

// ── Missing tests ──────────────────────────────────────────────────────────

export interface MissingTest {
  source: string;
  expected: string;
}

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Changed source files with no test file of the same name (`tasks.ts` → `tasks.test.ts`)
 * anywhere in the layer's test paths.
 */
export function findMissingTests(changed: FileChange[], layer: LayerConfig, existingFiles: string[]): MissingTest[] {
  const testedNames = new Set(
    existingFiles.filter((file) => matchesAny(file, layer.testPaths)).map((file) => basename(file).replace(TEST_FILE, "")),
  );

  return changed
    .filter((change) => change.status !== "deleted" && needsOwnTest(change.path, layer))
    .filter((change) => !testedNames.has(basename(change.path).replace(CODE_FILE, "")))
    .map((change) => ({
      source: change.path,
      expected: basename(change.path).replace(CODE_FILE, (extension) => `.test${extension}`),
    }));
}

function needsOwnTest(path: string, layer: LayerConfig): boolean {
  return (
    CODE_FILE.test(path) &&
    !path.endsWith(".d.ts") &&
    !TEST_FILE.test(path) &&
    matchesAny(path, layer.paths) &&
    !matchesAny(path, layer.testPaths) &&
    !matchesAny(path, layer.testExempt)
  );
}

// ── Test integrity ("did the agent cheat?") ──────────────────────────────

export type IntegrityIssue =
  | { file: string; kind: "deleted" }
  | { file: string; kind: "skips-added"; before: number; after: number }
  | { file: string; kind: "assertions-removed"; before: number; after: number };

/** `it.skip`, `describe.only`, `test.todo`, `it.skipIf`, `test.fails`, also chained like `describe.concurrent.skip`. */
const SKIP_OR_ONLY = /\b(?:describe|suite|it|test)(?:\.\w+)*\.(?:skip|skipIf|only|todo|fails)\b/g;
/** `expect(…)`, `expect.soft(…)`, Supertest's `.expect(200)`, `assert(…)` and `assert.equal(…)`. */
const ASSERTION = /\bexpect(?:\.soft)?\s*\(|\bassert(?:\.\w+)?\s*\(/g;

export interface FileReader {
  before(path: string): string;
  after(path: string): string;
}

/** Compares each changed test file with its version at the base commit. */
export function findIntegrityIssues(changedTests: FileChange[], read: FileReader): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  for (const { path, status } of changedTests) {
    if (status === "deleted") {
      issues.push({ file: path, kind: "deleted" });
      continue;
    }
    const before = withoutComments(read.before(path));
    const after = withoutComments(read.after(path));

    const skips = { before: count(before, SKIP_OR_ONLY), after: count(after, SKIP_OR_ONLY) };
    if (skips.after > skips.before) issues.push({ file: path, kind: "skips-added", ...skips });

    const assertions = { before: count(before, ASSERTION), after: count(after, ASSERTION) };
    if (assertions.after < assertions.before) issues.push({ file: path, kind: "assertions-removed", ...assertions });
  }
  return issues;
}

/** Drops block comments and whole-line `//` comments, so commented-out assertions don't count. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

// ── All checks for the layers that need to run ────────────────────────────

export interface LayerResult {
  layer: string;
  subagent: string;
  tests: TestRun;
  missingTests: MissingTest[];
  integrity: IntegrityIssue[];
}

export function layerPassed(result: LayerResult): boolean {
  return result.tests.passed && result.missingTests.length === 0 && result.integrity.length === 0;
}

export async function runChecks(
  root: string,
  base: string,
  config: GateConfig,
  classification: Classification,
): Promise<LayerResult[]> {
  const existingFiles = listFiles(root);
  const read: FileReader = {
    before: (path) => readAtBase(root, base, path),
    after: (path) => readCurrent(root, path),
  };

  return Promise.all(
    classification.layersToRun.map(async (name) => {
      const layer = config.layers[name]!;
      const changed = classification.filesByLayer[name] ?? [];
      const changedTests = changed.filter((change) => matchesAny(change.path, layer.testPaths));

      return {
        layer: name,
        subagent: layer.subagent,
        tests: await runTests(layer.testCommand, root),
        missingTests: findMissingTests(changed, layer, existingFiles),
        integrity: findIntegrityIssues(changedTests, read),
      };
    }),
  );
}
