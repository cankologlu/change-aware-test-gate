import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A throwaway git repository for tests. */
export function createTestRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-test-")));

  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" });

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Gate Test");
  git("config", "user.email", "gate-test@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");

  return {
    dir,
    git,
    write(path: string, content: string) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    },
    remove(path: string) {
      unlinkSync(join(dir, path));
    },
    commitAll(message = "commit") {
      git("add", "-A");
      git("commit", "-q", "-m", message);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type TestRepo = ReturnType<typeof createTestRepo>;
