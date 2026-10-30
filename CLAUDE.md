# Working rules

This repo has a test gate. When you try to finish, a Stop hook runs `scripts/gate/run.ts`. It looks at your uncommitted changes, runs the tests of every layer you touched, checks that changed code has tests, and blocks you from stopping until all of that passes. After 3 failed attempts it lets you stop and hands over to a human.

## How to work

- Plan first and wait for approval, then work in small chunks.
- Every code change needs tests in the same layer: `apps/api` changes need API tests, `apps/ui` changes need UI tests. A source file `foo.ts` needs a test file named `foo.test.ts` (or `.tsx`) in that layer. Changes to `packages/shared` run both layers' tests.
- Never skip, delete or weaken tests to make the gate pass. Fix the code.
- Never edit `scripts/gate/**` or `gate.config.json`.
- Don't commit. The gate checks your uncommitted changes, and a human reviews and commits them.
- For parallel work, use separate git worktrees instead of switching branches in one folder.

## When the gate blocks you

Read the report. For each layer it lists failing tests, files without tests and test-integrity problems, and names the subagent to use:

- `api-tester` for `apps/api`
- `ui-tester` for `apps/ui`

Delegate the fix to that subagent with the relevant part of the report, check what it changed, then finish again.

## Before you finish

1. Run `npm run gate`. It runs the same checks as the Stop hook without counting as an attempt.
2. When it passes, run the `code-reviewer` subagent on the final diff (`.gate/last-diff.patch`) and address its findings.
3. Finish. The Stop hook runs the gate one last time.

## Commands

- `npm test`: everything (gate unit tests, API, UI)
- `npm run test -w apps/api` or `npm run test -w apps/ui`: one layer
- `npm run gate`: the gate's checks, by hand
- `npm run typecheck`: TypeScript across the repo
- `npm run dev -w apps/api` (port 3001) and `npm run dev -w apps/ui`: run the app
