import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, loadConfig, matchesAny } from "./config";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

let dir: string | undefined;

function configDir(config: unknown): string {
  dir = mkdtempSync(join(tmpdir(), "gate-config-"));
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config));
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const layer = { paths: ["src/**"], testPaths: ["**/*.test.ts"], testCommand: "npm test", subagent: "tester" };

describe("loadConfig", () => {
  it("loads this repo's gate.config.json", () => {
    const config = loadConfig(REPO_ROOT);

    expect(Object.keys(config.layers)).toEqual(["api", "ui"]);
    expect(config.maxRetries).toBe(3);
  });

  it("fills in defaults for optional fields", () => {
    const config = loadConfig(configDir({ layers: { app: layer } }));

    expect(config).toMatchObject({ baseRef: "HEAD", maxRetries: 3, sharedPaths: [], ignorePaths: [] });
  });

  it("rejects a config without layers", () => {
    expect(() => loadConfig(configDir({ layers: {} }))).toThrow("at least one layer");
  });

  it("names the layer and field that is missing", () => {
    const { testCommand: _, ...withoutCommand } = layer;

    expect(() => loadConfig(configDir({ layers: { app: withoutCommand } }))).toThrow(
      'layer "app" is missing "testCommand"',
    );
  });
});

describe("matchesAny", () => {
  it("matches nested paths, dotfiles and brace alternatives", () => {
    expect(matchesAny("apps/api/src/routes/tasks.ts", ["apps/api/src/**"])).toBe(true);
    expect(matchesAny(".claude/agents/api-tester.md", ["**/*.md"])).toBe(true);
    expect(matchesAny("apps/ui/src/App.test.tsx", ["apps/ui/**/*.test.{ts,tsx}"])).toBe(true);
  });

  it("does not match unrelated paths or an empty glob list", () => {
    expect(matchesAny("apps/ui/src/App.tsx", ["apps/api/src/**"])).toBe(false);
    expect(matchesAny("apps/ui/src/App.tsx", [])).toBe(false);
  });
});
