import { describe, expect, it } from "vitest";
import type { LayerResult } from "./checks";
import type { Classification } from "./classify";
import { describeLayers, formatFailureReport, formatHandoffMessage, formatPassMessage, gatePassed } from "./report";

const sharedChange: Classification = {
  touched: ["api"],
  sharedFiles: ["packages/shared/src/task.ts"],
  layersToRun: ["api", "ui"],
  filesByLayer: {},
};

const apiFailing: LayerResult = {
  layer: "api",
  subagent: "api-tester",
  tests: { passed: false, failures: ["PATCH /tasks/:id › toggles done: expected 200, got 404"], output: "" },
  missingTests: [{ source: "apps/api/src/routes/archive.ts", expected: "archive.test.ts" }],
  integrity: [],
};

const uiPassing: LayerResult = {
  layer: "ui",
  subagent: "ui-tester",
  tests: { passed: true, failures: [], passedCount: 9, output: "" },
  missingTests: [],
  integrity: [],
};

describe("formatFailureReport", () => {
  it("tells the agent what failed, what to do and which subagent to use", () => {
    const report = formatFailureReport({ classification: sharedChange, results: [apiFailing, uiPassing] }, { number: 2, max: 3 });

    expect(report).toBe(
      [
        "GATE FAILED (attempt 2 of 3)",
        "",
        "Layers touched: api, shared (ui also runs because shared changed)",
        "",
        "[api] tests FAILED",
        "  - PATCH /tasks/:id › toggles done: expected 200, got 404",
        "  Action: use the api-tester subagent to investigate and fix. Fix the code, not the test,",
        "  unless the test is wrong. Explain if you change a test.",
        "",
        "[api] missing tests",
        "  - apps/api/src/routes/archive.ts has no archive.test.ts",
        "  Action: use the api-tester subagent to write tests for it.",
        "",
        "[ui] tests passed",
        "",
        "Rules: do not skip, delete or weaken tests. Do not edit scripts/gate/** or gate.config.json.",
      ].join("\n"),
    );
  });

  it("lists test integrity problems", () => {
    const cheating: LayerResult = {
      ...uiPassing,
      integrity: [
        { file: "apps/ui/src/App.test.tsx", kind: "skips-added", before: 0, after: 1 },
        { file: "apps/ui/src/api.test.ts", kind: "assertions-removed", before: 6, after: 4 },
        { file: "apps/ui/src/old.test.tsx", kind: "deleted" },
      ],
    };
    const ui: Classification = { touched: ["ui"], sharedFiles: [], layersToRun: ["ui"], filesByLayer: {} };

    const report = formatFailureReport({ classification: ui, results: [cheating] });

    expect(report).toContain("GATE FAILED\n");
    expect(report).toContain("  - apps/ui/src/App.test.tsx adds .skip/.only/.todo/.fails (0 → 1)");
    expect(report).toContain("  - apps/ui/src/api.test.ts has fewer assertions (6 → 4)");
    expect(report).toContain("  - apps/ui/src/old.test.tsx was deleted");
    expect(report).toContain("Action: restore the tests.");
  });
});

describe("describeLayers", () => {
  it("lists the touched layers", () => {
    expect(describeLayers({ touched: ["api", "ui"], sharedFiles: [], layersToRun: ["api", "ui"], filesByLayer: {} })).toBe(
      "api, ui",
    );
  });

  it("explains layers that run only because shared code changed", () => {
    expect(describeLayers({ touched: [], sharedFiles: ["x"], layersToRun: ["api", "ui"], filesByLayer: {} })).toBe(
      "shared (api, ui also run because shared changed)",
    );
  });
});

describe("terminal messages", () => {
  it("summarizes a pass", () => {
    const apiPassing: LayerResult = { ...uiPassing, layer: "api", subagent: "api-tester", tests: { ...uiPassing.tests, passedCount: 14 } };

    expect(formatPassMessage({ classification: sharedChange, results: [apiPassing, uiPassing] })).toBe(
      "✓ Gate passed. Layers touched: api, shared (ui also runs because shared changed). Tests: api 14 passed, ui 9 passed.",
    );
  });

  it("names what is still failing when handing off to a human", () => {
    const message = formatHandoffMessage(
      { classification: sharedChange, results: [apiFailing, uiPassing] },
      { number: 3, max: 3 },
      ".gate/reports/x-needs-human.md",
    );

    expect(message).toBe(
      "✗ Gate failed 3 times in a row (limit 3): api tests failing, api missing tests. " +
        "Claude was allowed to stop. Needs human review, see .gate/reports/x-needs-human.md",
    );
  });
});

describe("gatePassed", () => {
  it("passes only when every layer passes all checks", () => {
    expect(gatePassed([uiPassing])).toBe(true);
    expect(gatePassed([uiPassing, apiFailing])).toBe(false);
    expect(gatePassed([{ ...uiPassing, missingTests: [{ source: "a.ts", expected: "a.test.ts" }] }])).toBe(false);
  });
});
