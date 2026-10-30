import { describe, expect, it } from "vitest";
import { classify } from "./classify";
import type { GateConfig } from "./config";
import type { FileChange } from "./diff";

const config: GateConfig = {
  baseRef: "HEAD",
  maxRetries: 3,
  layers: {
    api: {
      paths: ["apps/api/src/**"],
      testPaths: ["apps/api/**/*.test.ts"],
      testCommand: "npm run test -w apps/api",
      subagent: "api-tester",
    },
    ui: {
      paths: ["apps/ui/src/**"],
      testPaths: ["apps/ui/**/*.test.{ts,tsx}"],
      testCommand: "npm run test -w apps/ui",
      subagent: "ui-tester",
    },
  },
  sharedPaths: ["packages/shared/**"],
  ignorePaths: ["**/*.md", ".gate/**", ".claude/**"],
};

function modified(...paths: string[]): FileChange[] {
  return paths.map((path) => ({ path, status: "modified" }));
}

describe("classify", () => {
  it("maps a file to its layer and runs only that layer", () => {
    const result = classify(modified("apps/api/src/routes/tasks.ts"), config);

    expect(result.touched).toEqual(["api"]);
    expect(result.layersToRun).toEqual(["api"]);
    expect(result.filesByLayer.api).toEqual(modified("apps/api/src/routes/tasks.ts"));
    expect(result.filesByLayer.ui).toBeUndefined();
  });

  it("runs both layers when both have changes", () => {
    const result = classify(modified("apps/api/src/store.ts", "apps/ui/src/App.tsx"), config);

    expect(result.touched).toEqual(["api", "ui"]);
    expect(result.layersToRun).toEqual(["api", "ui"]);
  });

  it("runs every layer when shared code changed", () => {
    const result = classify(modified("apps/api/src/store.ts", "packages/shared/src/task.ts"), config);

    expect(result.touched).toEqual(["api"]);
    expect(result.sharedFiles).toEqual(["packages/shared/src/task.ts"]);
    expect(result.layersToRun).toEqual(["api", "ui"]);
  });

  it("runs every layer for a shared-only change", () => {
    const result = classify(modified("packages/shared/src/task.ts"), config);

    expect(result.touched).toEqual([]);
    expect(result.layersToRun).toEqual(["api", "ui"]);
  });

  it("skips ignored paths, even inside a layer", () => {
    const result = classify(
      modified("README.md", "apps/api/src/NOTES.md", ".claude/settings.json", ".gate/state.json"),
      config,
    );

    expect(result.layersToRun).toEqual([]);
    expect(result.filesByLayer).toEqual({});
  });

  it("runs nothing for files outside every layer", () => {
    expect(classify(modified("package.json", "scripts/gate/run.ts"), config).layersToRun).toEqual([]);
  });

  it("counts test files outside the source paths as part of their layer", () => {
    const result = classify([{ path: "apps/api/test/legacy.test.ts", status: "deleted" }], config);

    expect(result.touched).toEqual(["api"]);
  });

  it("matches .ts and .tsx test files with brace globs", () => {
    const result = classify(modified("apps/ui/tests/api.test.ts", "apps/ui/tests/App.test.tsx"), config);

    expect(result.filesByLayer.ui).toHaveLength(2);
  });
});
