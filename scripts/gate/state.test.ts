import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadState, recordRun, saveState, type GateState } from "./state";

const EMPTY: GateState = { sessions: {} };
/** First stop since the user's last message (`stop_hook_active` false). */
const FIRST_FAILURE = { passed: false, newTurn: true };
/** A later stop in the same request, after the gate blocked (`stop_hook_active` true). */
const RETRY_FAILURE = { passed: false, newTurn: false };
const PASS = { passed: true, newTurn: false };

describe("recordRun", () => {
  it("blocks the first failure as attempt 1", () => {
    const { state, decision } = recordRun(EMPTY, "s1", FIRST_FAILURE, 3);

    expect(decision).toEqual({ action: "block", attempt: 1 });
    expect(state.sessions.s1?.failures).toBe(1);
  });

  it("increments on each failure in the same request", () => {
    const first = recordRun(EMPTY, "s1", FIRST_FAILURE, 3);
    const second = recordRun(first.state, "s1", RETRY_FAILURE, 3);

    expect(second.decision).toEqual({ action: "block", attempt: 2 });
    expect(second.state.sessions.s1?.failures).toBe(2);
  });

  it("allows the stop and hands off to a human at the limit", () => {
    const first = recordRun(EMPTY, "s1", FIRST_FAILURE, 3);
    const second = recordRun(first.state, "s1", RETRY_FAILURE, 3);
    const third = recordRun(second.state, "s1", RETRY_FAILURE, 3);

    expect(third.decision).toEqual({ action: "handoff", attempt: 3 });
    expect(third.state.sessions.s1).toBeUndefined();
  });

  it("resets when the gate passes", () => {
    const failed = recordRun(EMPTY, "s1", FIRST_FAILURE, 3);
    const passed = recordRun(failed.state, "s1", PASS, 3);

    expect(passed.decision).toEqual({ action: "allow" });
    expect(passed.state.sessions.s1).toBeUndefined();
    expect(recordRun(passed.state, "s1", RETRY_FAILURE, 3).decision).toEqual({ action: "block", attempt: 1 });
  });

  it("starts over on a new request, even if the last one was interrupted mid-retry", () => {
    const first = recordRun(EMPTY, "s1", FIRST_FAILURE, 3);
    const second = recordRun(first.state, "s1", RETRY_FAILURE, 3);

    expect(recordRun(second.state, "s1", FIRST_FAILURE, 3).decision).toEqual({ action: "block", attempt: 1 });
  });

  it("counts each session separately", () => {
    const { state } = recordRun(EMPTY, "s1", FIRST_FAILURE, 3);

    expect(recordRun(state, "s2", RETRY_FAILURE, 3).decision).toEqual({ action: "block", attempt: 1 });
  });

  it("hands off on the first failure when maxRetries is 1", () => {
    expect(recordRun(EMPTY, "s1", FIRST_FAILURE, 1).decision).toEqual({ action: "handoff", attempt: 1 });
  });

  it("leaves the state it was given unchanged", () => {
    const before: GateState = { sessions: { s1: { failures: 1, updatedAt: "earlier" } } };

    recordRun(before, "s1", RETRY_FAILURE, 3);

    expect(before.sessions.s1).toEqual({ failures: 1, updatedAt: "earlier" });
  });
});

describe("loadState and saveState", () => {
  it("round-trip through a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-state-"));
    const file = join(dir, "nested", "state.json");
    const state: GateState = { sessions: { s1: { failures: 2, updatedAt: "2026-01-01T00:00:00.000Z" } } };

    saveState(file, state);

    expect(loadState(file)).toEqual(state);
    rmSync(dir, { recursive: true, force: true });
  });

  it("start empty when the file is missing or corrupt", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-state-"));
    const file = join(dir, "state.json");

    expect(loadState(file)).toEqual(EMPTY);
    writeFileSync(file, "{ not json");
    expect(loadState(file)).toEqual(EMPTY);
    rmSync(dir, { recursive: true, force: true });
  });
});
