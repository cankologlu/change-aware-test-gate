import { describe, expect, it } from "vitest";
import type { LayerConfig } from "./config";
import type { FileChange } from "./diff";
import { findIntegrityIssues, findMissingTests, runTests, summarizeFailures, type FileReader } from "./checks";

// Trimmed from a real `vitest run` with a broken toggle.
const VITEST_FAILURE = `
 RUN  v4.1.12 /repo/apps/api

 ❯ src/store.test.ts (4 tests | 1 failed) 4ms
     × toggles done back and forth 2ms
 ❯ src/routes/tasks.test.ts (8 tests | 1 failed) 30ms
     × toggles done 5ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/store.test.ts > createTaskStore > toggles done back and forth
AssertionError: expected undefined to be true // Object.is equality

 FAIL  src/routes/tasks.test.ts > PATCH /tasks/:id > toggles done
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

 Test Files  2 failed | 1 passed (3)
      Tests  2 failed | 12 passed (14)
`;

describe("summarizeFailures", () => {
  it("gives one short line per failing Vitest test", () => {
    expect(summarizeFailures(VITEST_FAILURE)).toEqual([
      "createTaskStore › toggles done back and forth: expected true, got undefined",
      "PATCH /tasks/:id › toggles done: expected 200, got 404",
    ]);
  });

  it("keeps messages it can't simplify", () => {
    const output = ' FAIL  src/a.test.ts > adds\nAssertionError: expected [ 1 ] to deeply equal [ 1, 2 ]\n';

    expect(summarizeFailures(output)).toEqual(["adds: expected [ 1 ] to deeply equal [ 1, 2 ]"]);
  });

  it("names the file when a test file fails to load", () => {
    const output = " FAIL  src/routes/archive.test.ts [ src/routes/archive.test.ts ]\nError: Failed to load url ./archive\n";

    expect(summarizeFailures(output)).toEqual(["src/routes/archive.test.ts: Failed to load url ./archive"]);
  });

  it("falls back to error lines for other output, without npm noise", () => {
    const output = "building...\nTypeError: Cannot read properties of undefined\nnpm error code 1\n";

    expect(summarizeFailures(output)).toEqual(["TypeError: Cannot read properties of undefined"]);
  });

  it("caps a long list of failures", () => {
    const output = Array.from({ length: 12 }, (_, i) => ` FAIL  a.test.ts > case ${i}\nError: boom`).join("\n");

    const failures = summarizeFailures(output, 3);
    expect(failures).toHaveLength(4);
    expect(failures.at(-1)).toBe("…and 9 more");
  });
});

describe("runTests", () => {
  it("reports a passing command and how many tests passed", async () => {
    const run = await runTests(`node -e "console.log('Tests  3 passed (3)')"`, process.cwd());

    expect(run.passed).toBe(true);
    expect(run.passedCount).toBe(3);
  });

  it("reports a failing command with a failure summary", async () => {
    const run = await runTests(
      `node -e "console.log(' FAIL  a.test.ts > adds'); console.log('Error: boom'); process.exit(1)"`,
      process.cwd(),
    );

    expect(run.passed).toBe(false);
    expect(run.failures).toEqual(["adds: boom"]);
  });

  it("stops a command that runs too long", async () => {
    const run = await runTests(`node -e "setTimeout(() => {}, 10000)"`, process.cwd(), 200);

    expect(run.passed).toBe(false);
    expect(run.output).toContain("Stopped after 0.2s");
  });
});

describe("findMissingTests", () => {
  const layer: LayerConfig = {
    paths: ["apps/api/src/**"],
    testPaths: ["apps/api/**/*.test.ts"],
    testExempt: ["apps/api/src/server.ts"],
    testCommand: "npm test",
    subagent: "api-tester",
  };
  const existing = ["apps/api/src/routes/tasks.ts", "apps/api/src/routes/tasks.test.ts", "apps/api/test/store.test.ts"];

  it("reports a changed source file without a test of the same name", () => {
    const changed: FileChange[] = [{ path: "apps/api/src/routes/archive.ts", status: "added" }];

    expect(findMissingTests(changed, layer, existing)).toEqual([
      { source: "apps/api/src/routes/archive.ts", expected: "archive.test.ts" },
    ]);
  });

  it("accepts a test next to the file or anywhere in the layer's test paths", () => {
    const changed: FileChange[] = [
      { path: "apps/api/src/routes/tasks.ts", status: "modified" },
      { path: "apps/api/src/store.ts", status: "modified" },
    ];

    expect(findMissingTests(changed, layer, existing)).toEqual([]);
  });

  it("ignores deleted files, test files, type declarations, non-code files and exempt files", () => {
    const changed: FileChange[] = [
      { path: "apps/api/src/old.ts", status: "deleted" },
      { path: "apps/api/src/routes/tasks.test.ts", status: "modified" },
      { path: "apps/api/src/types.d.ts", status: "added" },
      { path: "apps/api/src/data.json", status: "added" },
      { path: "apps/api/src/server.ts", status: "modified" },
    ];

    expect(findMissingTests(changed, layer, existing)).toEqual([]);
  });

  it("suggests a .tsx test name for a .tsx component", () => {
    const uiLayer = { ...layer, paths: ["apps/ui/src/**"], testPaths: ["apps/ui/**/*.test.{ts,tsx}"] };
    const changed: FileChange[] = [{ path: "apps/ui/src/Archive.tsx", status: "added" }];

    expect(findMissingTests(changed, uiLayer, [])).toEqual([{ source: "apps/ui/src/Archive.tsx", expected: "Archive.test.tsx" }]);
  });
});

describe("findIntegrityIssues", () => {
  const BEFORE = `
    it("creates a task", async () => {
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Buy milk");
    });
    it("rejects a blank title", async () => {
      await request(app).post("/tasks").send({ title: "" }).expect(400);
    });
  `;

  function reader(before: string, after: string): FileReader {
    return { before: () => before, after: () => after };
  }

  const changed: FileChange[] = [{ path: "tasks.test.ts", status: "modified" }];

  it("accepts edits that keep or add assertions", () => {
    const after = `${BEFORE}\n it("toggles", () => { expect(done).toBe(true); });`;

    expect(findIntegrityIssues(changed, reader(BEFORE, after))).toEqual([]);
  });

  it("flags added .skip, .only and .todo", () => {
    const after = BEFORE.replace('it("creates', 'it.only("creates').replace('it("rejects', 'it.skip("rejects');

    expect(findIntegrityIssues(changed, reader(BEFORE, after))).toEqual([
      { file: "tasks.test.ts", kind: "skips-added", before: 0, after: 2 },
    ]);
  });

  it("flags removed assertions, including Supertest's .expect()", () => {
    const after = BEFORE.replace("      expect(res.body.title).toBe(\"Buy milk\");\n", "").replace(".expect(400)", "");

    expect(findIntegrityIssues(changed, reader(BEFORE, after))).toEqual([
      { file: "tasks.test.ts", kind: "assertions-removed", before: 3, after: 1 },
    ]);
  });

  it("does not count commented-out assertions", () => {
    const after = BEFORE.replace("      expect(res.status)", "      // expect(res.status)");

    expect(findIntegrityIssues(changed, reader(BEFORE, after))).toEqual([
      { file: "tasks.test.ts", kind: "assertions-removed", before: 3, after: 2 },
    ]);
  });

  it("flags deleted test files", () => {
    const deleted: FileChange[] = [{ path: "store.test.ts", status: "deleted" }];

    expect(findIntegrityIssues(deleted, reader(BEFORE, ""))).toEqual([{ file: "store.test.ts", kind: "deleted" }]);
  });

  it("flags .todo placeholders in a brand-new test file", () => {
    const added: FileChange[] = [{ path: "archive.test.ts", status: "added" }];

    expect(findIntegrityIssues(added, reader("", 'it.todo("archives a task");'))).toEqual([
      { file: "archive.test.ts", kind: "skips-added", before: 0, after: 1 },
    ]);
  });
});
