import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestRepo, type TestRepo } from "./test-repo";

const TSX = resolve(import.meta.dirname, "../../node_modules/.bin/tsx");
const RUN = resolve(import.meta.dirname, "run.ts");

// A tiny repo with one layer. Its "test suite" fails, Vitest-style, while src/math.js contains BUG.
const CONFIG = {
  baseRef: "HEAD",
  maxRetries: 3,
  layers: {
    app: { paths: ["src/**"], testPaths: ["src/**/*.test.js"], testCommand: "node check.mjs", subagent: "app-tester" },
  },
  sharedPaths: [],
  ignorePaths: ["**/*.md", ".gate/**"],
};

const CHECK_SCRIPT = `
import { readFileSync } from "node:fs";
if (readFileSync("src/math.js", "utf8").includes("BUG")) {
  console.log(" FAIL  src/math.test.js > add > adds two numbers");
  console.log("AssertionError: expected 5 to be 4 // Object.is equality");
  process.exit(1);
}
console.log("      Tests  1 passed (1)");
`;

const WORKING = "export const add = (a, b) => a + b;\n";
const BROKEN = "export const add = (a, b) => a + b + 1; // BUG\n";
const TEST = 'it("adds two numbers", () => { expect(add(2, 2)).toBe(4); });\n';

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo();
  repo.write("gate.config.json", JSON.stringify(CONFIG));
  repo.write("check.mjs", CHECK_SCRIPT);
  repo.write(".gitignore", ".gate/\n");
  repo.write("src/math.js", WORKING);
  repo.write("src/math.test.js", TEST);
  repo.commitAll();
});

afterEach(() => {
  repo.cleanup();
});

/** Runs the gate the way Claude Code's Stop hook does: hook input as JSON on stdin. */
function stopHook(stopHookActive = false) {
  const input = { session_id: "test-session", cwd: repo.dir, hook_event_name: "Stop", stop_hook_active: stopHookActive };
  const result = spawnSync(TSX, [RUN], { cwd: repo.dir, input: JSON.stringify(input), encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout,
    // Claude Code only reads stdout as JSON when it holds exactly one JSON object.
    json: result.stdout.trim() ? JSON.parse(result.stdout) : undefined,
  };
}

function reports(): string[] {
  return readdirSync(join(repo.dir, ".gate", "reports"));
}

describe("as a Stop hook", { timeout: 30_000 }, () => {
  it("lets Claude stop silently when no layer changed", () => {
    repo.write("README.md", "notes");

    expect(stopHook()).toMatchObject({ status: 0, stdout: "" });
  });

  it("blocks with a report, then hands off to a human on the third failure", () => {
    repo.write("src/math.js", BROKEN);

    const first = stopHook(false);
    expect(first.status).toBe(0);
    expect(first.json.decision).toBe("block");
    expect(first.json.reason).toContain("GATE FAILED (attempt 1 of 3)");
    expect(first.json.reason).toContain("[app] tests FAILED\n  - add › adds two numbers: expected 4, got 5");
    expect(first.json.reason).toContain("use the app-tester subagent");

    const second = stopHook(true);
    expect(second.json.reason).toContain("GATE FAILED (attempt 2 of 3)");

    const third = stopHook(true);
    expect(third.json.decision).toBeUndefined();
    expect(third.json.systemMessage).toContain("Gate failed 3 times in a row");
    expect(third.json.systemMessage).toContain("Needs human review");
    expect(reports().some((file) => file.endsWith("-needs-human.md"))).toBe(true);
  });

  it("lets Claude stop once the code is fixed, and resets the counter", () => {
    repo.write("src/math.js", BROKEN);
    stopHook(false);

    repo.write("src/math.js", `${WORKING}// fixed\n`);
    const fixed = stopHook(true);

    expect(fixed.json).toEqual({
      systemMessage: "✓ Gate passed. Layers touched: app. Tests: app 1 passed.",
    });
    expect(JSON.parse(readFileSync(join(repo.dir, ".gate", "state.json"), "utf8")).sessions).toEqual({});
    expect(reports().some((file) => file.endsWith("-pass.md"))).toBe(true);
  });

  it("starts the count over when you send a new message", () => {
    repo.write("src/math.js", BROKEN);
    stopHook(false);
    stopHook(true);

    expect(stopHook(false).json.reason).toContain("GATE FAILED (attempt 1 of 3)");
  });

  it("blocks a new source file that has no test", () => {
    repo.write("src/util.js", "export const id = (x) => x;\n");

    const run = stopHook();
    expect(run.json.reason).toContain("[app] missing tests\n  - src/util.js has no util.test.js");
  });

  it("blocks a skipped test", () => {
    repo.write("src/math.test.js", TEST.replace("it(", "it.skip("));

    expect(stopHook().json.reason).toContain("src/math.test.js adds .skip/.only/.todo/.fails (0 → 1)");
  });

  it("saves the diff for the read-only reviewer", () => {
    repo.write("src/util.js", "export const id = (x) => x;\n");
    stopHook();

    expect(readFileSync(join(repo.dir, ".gate", "last-diff.patch"), "utf8")).toContain("+export const id");
  });
});

describe("as `npm run gate`", { timeout: 30_000 }, () => {
  it("prints the report, exits 1 and leaves the retry counter alone", () => {
    repo.write("src/math.js", BROKEN);

    const result = spawnSync(TSX, [RUN, "--manual"], { cwd: repo.dir, encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("GATE FAILED\n");
    expect(existsSync(join(repo.dir, ".gate", "state.json"))).toBe(false);
  });

  it("says when there is nothing to check", () => {
    const result = spawnSync(TSX, [RUN, "--manual"], { cwd: repo.dir, encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to check");
  });
});
