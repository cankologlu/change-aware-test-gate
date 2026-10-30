import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface GateState {
  /** Failed stop attempts in a row, per Claude Code session. */
  sessions: Record<string, { failures: number; updatedAt: string }>;
}

export type Decision =
  | { action: "allow" }
  | { action: "block"; attempt: number }
  | { action: "handoff"; attempt: number };

export function loadState(file: string): GateState {
  try {
    const state = JSON.parse(readFileSync(file, "utf8")) as GateState;
    return typeof state?.sessions === "object" && state.sessions !== null ? state : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

export function saveState(file: string, state: GateState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Records one gate run for a session and decides what happens to the stop.
 *
 * `newTurn` is true when Claude stops for the first time since your last message (the hook's
 * `stop_hook_active` is false). Failures from earlier requests then no longer count, so a
 * request that needed a human doesn't leave the next one without retries.
 */
export function recordRun(
  state: GateState,
  sessionId: string,
  run: { passed: boolean; newTurn: boolean },
  maxRetries: number,
  now = new Date(),
): { state: GateState; decision: Decision } {
  const { [sessionId]: previous, ...others } = state.sessions;

  if (run.passed) return { state: { sessions: others }, decision: { action: "allow" } };

  const attempt = (run.newTurn ? 0 : (previous?.failures ?? 0)) + 1;
  if (attempt >= maxRetries) return { state: { sessions: others }, decision: { action: "handoff", attempt } };

  return {
    state: { sessions: { ...others, [sessionId]: { failures: attempt, updatedAt: now.toISOString() } } },
    decision: { action: "block", attempt },
  };
}
