import { readFileSync } from "node:fs";
import { join } from "node:path";
import picomatch from "picomatch";

export const CONFIG_FILE = "gate.config.json";

export interface LayerConfig {
  /** Source files of this layer. A change here runs the layer's tests. */
  paths: string[];
  /** Test files of this layer. A change here also runs the layer's tests. */
  testPaths: string[];
  /** Source files that don't need their own test file, such as entry points. */
  testExempt?: string[];
  testCommand: string;
  /** The subagent the report tells the main agent to delegate this layer's fixes to. */
  subagent: string;
}

export interface GateConfig {
  /** What to diff against. `HEAD` checks uncommitted work; a branch such as `main` also checks commits since it. */
  baseRef: string;
  /** Failed stop attempts before the gate gives up and hands over to a human. */
  maxRetries: number;
  layers: Record<string, LayerConfig>;
  /** Code used by every layer. A change here runs every layer's tests. */
  sharedPaths: string[];
  ignorePaths: string[];
}

const REQUIRED_LAYER_FIELDS = ["paths", "testPaths", "testCommand", "subagent"] as const;

export function loadConfig(root: string): GateConfig {
  const raw = JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")) as Partial<GateConfig>;
  const config: GateConfig = { baseRef: "HEAD", maxRetries: 3, layers: {}, sharedPaths: [], ignorePaths: [], ...raw };

  if (Object.keys(config.layers).length === 0) {
    throw new Error(`${CONFIG_FILE} must define at least one layer`);
  }
  for (const [name, layer] of Object.entries(config.layers)) {
    for (const field of REQUIRED_LAYER_FIELDS) {
      if (!layer[field]) throw new Error(`${CONFIG_FILE}: layer "${name}" is missing "${field}"`);
    }
  }
  return config;
}

/** True if a repo-relative path matches any of the globs. Dotfiles match too. */
export function matchesAny(path: string, globs: string[] = []): boolean {
  return globs.length > 0 && picomatch.isMatch(path, globs, { dot: true });
}
