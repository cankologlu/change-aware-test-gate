import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectChanges, diffPatch, listFiles, readAtBase, readCurrent, repoRoot, resolveBase } from "./diff";
import { createTestRepo, type TestRepo } from "./test-repo";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo();
});

afterEach(() => {
  repo.cleanup();
});

describe("collectChanges", () => {
  it("finds unstaged, staged, untracked and deleted files", () => {
    repo.write("keep.ts", "same");
    repo.write("edit.ts", "before");
    repo.write("remove.ts", "gone soon");
    repo.commitAll();

    repo.write("edit.ts", "after");
    repo.write("staged.ts", "new");
    repo.git("add", "staged.ts");
    repo.write("untracked.ts", "new");
    repo.remove("remove.ts");

    expect(collectChanges(repo.dir, resolveBase(repo.dir, "HEAD"))).toEqual([
      { path: "edit.ts", status: "modified" },
      { path: "remove.ts", status: "deleted" },
      { path: "staged.ts", status: "added" },
      { path: "untracked.ts", status: "added" },
    ]);
  });

  it("reports nothing for a clean working tree", () => {
    repo.write("a.ts", "1");
    repo.commitAll();

    expect(collectChanges(repo.dir, resolveBase(repo.dir, "HEAD"))).toEqual([]);
  });

  it("leaves out gitignored files", () => {
    repo.write(".gitignore", ".gate/\n");
    repo.commitAll();
    repo.write(".gate/state.json", "{}");

    expect(collectChanges(repo.dir, resolveBase(repo.dir, "HEAD"))).toEqual([]);
  });

  it("treats every file as added before the first commit", () => {
    repo.write("a.ts", "1");

    expect(collectChanges(repo.dir, resolveBase(repo.dir, "HEAD"))).toEqual([{ path: "a.ts", status: "added" }]);
  });

  it("includes commits made since a branch base", () => {
    repo.write("a.ts", "1");
    repo.commitAll();
    repo.git("checkout", "-q", "-b", "feature");
    repo.write("b.ts", "1");
    repo.commitAll();

    expect(collectChanges(repo.dir, resolveBase(repo.dir, "HEAD"))).toEqual([]);
    expect(collectChanges(repo.dir, resolveBase(repo.dir, "main"))).toEqual([{ path: "b.ts", status: "added" }]);
  });
});

describe("resolveBase", () => {
  it("explains an unknown baseRef", () => {
    repo.write("a.ts", "1");
    repo.commitAll();

    expect(() => resolveBase(repo.dir, "no-such-branch")).toThrow('baseRef "no-such-branch" is not a commit');
  });
});

describe("file helpers", () => {
  it("reads a file before and after the change", () => {
    repo.write("a.ts", "before");
    repo.commitAll();
    repo.write("a.ts", "after");
    repo.write("new.ts", "fresh");
    const base = resolveBase(repo.dir, "HEAD");

    expect(readAtBase(repo.dir, base, "a.ts")).toBe("before");
    expect(readCurrent(repo.dir, "a.ts")).toBe("after");
    expect(readAtBase(repo.dir, base, "new.ts")).toBe("");
    expect(readCurrent(repo.dir, "missing.ts")).toBe("");
  });

  it("lists current files, without deleted ones", () => {
    repo.write("a.ts", "1");
    repo.write("b.ts", "1");
    repo.commitAll();
    repo.remove("b.ts");
    repo.write("c.ts", "1");

    expect(listFiles(repo.dir).sort()).toEqual(["a.ts", "c.ts"]);
  });

  it("finds the repo root from a subdirectory", () => {
    repo.write("nested/dir/a.ts", "1");

    expect(repoRoot(join(repo.dir, "nested/dir"))).toBe(repo.dir);
  });

  it("builds a patch that includes untracked files", () => {
    repo.write("a.ts", "before\n");
    repo.commitAll();
    repo.write("a.ts", "after\n");
    repo.write("new.ts", "fresh\n");

    const patch = diffPatch(repo.dir, resolveBase(repo.dir, "HEAD"));

    expect(patch).toContain("+after");
    expect(patch).toContain("+fresh");
  });
});
