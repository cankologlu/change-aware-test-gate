import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ChangeStatus = "added" | "modified" | "deleted";

export interface FileChange {
  /** Path relative to the repo root, with forward slashes. */
  path: string;
  status: ChangeStatus;
}

/** git's id for the empty tree. Diffing against it makes every file count as added. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Runs a git diff command, which exits with 1 when it finds differences. */
function gitDiff(root: string, args: string[]): string {
  try {
    return git(root, args);
  } catch (err) {
    const { status, stdout } = err as { status?: number; stdout?: string };
    if (status === 1 && typeof stdout === "string") return stdout;
    throw err;
  }
}

function splitNul(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

export function repoRoot(cwd: string): string {
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}

/**
 * The commit to compare against. For `HEAD` that's the current commit; for a branch
 * such as `main` it's where the current branch split off, so commits made since count too.
 */
export function resolveBase(root: string, baseRef: string): string {
  try {
    git(root, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    return EMPTY_TREE; // No commits yet.
  }
  try {
    return git(root, ["merge-base", baseRef, "HEAD"]).trim();
  } catch {
    throw new Error(`baseRef "${baseRef}" is not a commit or branch in this repository`);
  }
}

/** Every file that differs from `base`: committed since, staged, unstaged and untracked. */
export function collectChanges(root: string, base: string): FileChange[] {
  const changes = new Map<string, ChangeStatus>();

  // --no-renames reports a rename as a delete plus an add, so a moved test file still counts as deleted.
  const entries = splitNul(git(root, ["diff", "--name-status", "--no-renames", "-z", base]));
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const code = entries[i];
    changes.set(entries[i + 1]!, code === "A" ? "added" : code === "D" ? "deleted" : "modified");
  }
  for (const path of splitNul(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))) {
    changes.set(path, "added");
  }

  return [...changes]
    .map(([path, status]) => ({ path, status }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** All files in the working tree that git knows about or would track (ignored files excluded). */
export function listFiles(root: string): string[] {
  const files = splitNul(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]));
  return files.filter((path) => existsSync(join(root, path)));
}

/** A file's content at `base`, or "" if it didn't exist there. */
export function readAtBase(root: string, base: string, path: string): string {
  try {
    return git(root, ["show", `${base}:${path}`]);
  } catch {
    return "";
  }
}

/** A file's current content, or "" if it was deleted. */
export function readCurrent(root: string, path: string): string {
  const fullPath = join(root, path);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

/** The whole change as a patch, including untracked files, for the read-only reviewer. */
export function diffPatch(root: string, base: string): string {
  const tracked = git(root, ["diff", "--no-color", "--no-renames", base]);
  const untracked = splitNul(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])).map((path) =>
    gitDiff(root, ["diff", "--no-color", "--no-index", "--", "/dev/null", path]),
  );
  return [tracked, ...untracked].join("");
}
