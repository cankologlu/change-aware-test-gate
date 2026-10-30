import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectChanges, diffPatch, listFiles, readAtBase, readCurrent, repoRoot, resolveBase } from "./diff";

let repo: string;

function git(...args: string[]) {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

function write(path: string, content: string) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

function commitAll(message = "commit") {
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "gate-diff-")));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Gate Test");
  git("config", "user.email", "gate-test@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("collectChanges", () => {
  it("finds unstaged, staged, untracked and deleted files", () => {
    write("keep.ts", "same");
    write("edit.ts", "before");
    write("remove.ts", "gone soon");
    commitAll();

    write("edit.ts", "after");
    write("staged.ts", "new");
    git("add", "staged.ts");
    write("untracked.ts", "new");
    unlinkSync(join(repo, "remove.ts"));

    expect(collectChanges(repo, resolveBase(repo, "HEAD"))).toEqual([
      { path: "edit.ts", status: "modified" },
      { path: "remove.ts", status: "deleted" },
      { path: "staged.ts", status: "added" },
      { path: "untracked.ts", status: "added" },
    ]);
  });

  it("reports nothing for a clean working tree", () => {
    write("a.ts", "1");
    commitAll();

    expect(collectChanges(repo, resolveBase(repo, "HEAD"))).toEqual([]);
  });

  it("leaves out gitignored files", () => {
    write(".gitignore", ".gate/\n");
    commitAll();
    write(".gate/state.json", "{}");

    expect(collectChanges(repo, resolveBase(repo, "HEAD"))).toEqual([]);
  });

  it("treats every file as added before the first commit", () => {
    write("a.ts", "1");

    expect(collectChanges(repo, resolveBase(repo, "HEAD"))).toEqual([{ path: "a.ts", status: "added" }]);
  });

  it("includes commits made since a branch base", () => {
    write("a.ts", "1");
    commitAll();
    git("checkout", "-q", "-b", "feature");
    write("b.ts", "1");
    commitAll();

    expect(collectChanges(repo, resolveBase(repo, "HEAD"))).toEqual([]);
    expect(collectChanges(repo, resolveBase(repo, "main"))).toEqual([{ path: "b.ts", status: "added" }]);
  });
});

describe("resolveBase", () => {
  it("explains an unknown baseRef", () => {
    write("a.ts", "1");
    commitAll();

    expect(() => resolveBase(repo, "no-such-branch")).toThrow('baseRef "no-such-branch" is not a commit');
  });
});

describe("file helpers", () => {
  it("reads a file before and after the change", () => {
    write("a.ts", "before");
    commitAll();
    write("a.ts", "after");
    write("new.ts", "fresh");
    const base = resolveBase(repo, "HEAD");

    expect(readAtBase(repo, base, "a.ts")).toBe("before");
    expect(readCurrent(repo, "a.ts")).toBe("after");
    expect(readAtBase(repo, base, "new.ts")).toBe("");
    expect(readCurrent(repo, "missing.ts")).toBe("");
  });

  it("lists current files, without deleted ones", () => {
    write("a.ts", "1");
    write("b.ts", "1");
    commitAll();
    unlinkSync(join(repo, "b.ts"));
    write("c.ts", "1");

    expect(listFiles(repo).sort()).toEqual(["a.ts", "c.ts"]);
  });

  it("finds the repo root from a subdirectory", () => {
    write("nested/dir/a.ts", "1");

    expect(repoRoot(join(repo, "nested/dir"))).toBe(repo);
  });

  it("builds a patch that includes untracked files", () => {
    write("a.ts", "before\n");
    commitAll();
    write("a.ts", "after\n");
    write("new.ts", "fresh\n");

    const patch = diffPatch(repo, resolveBase(repo, "HEAD"));

    expect(patch).toContain("+after");
    expect(patch).toContain("+fresh");
  });
});
