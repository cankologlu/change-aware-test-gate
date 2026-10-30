import { z } from "zod";

export const TITLE_MAX_LENGTH = 100;

export interface Task {
  id: string;
  title: string;
  done: boolean;
}

export const TaskTitleSchema = z
  .string({
    error: (issue) => (issue.input === undefined ? "Title is required" : "Title must be a string"),
  })
  .trim()
  .min(1, "Title is required")
  .max(TITLE_MAX_LENGTH, `Title must be at most ${TITLE_MAX_LENGTH} characters`);

export type TitleResult = { ok: true; title: string } | { ok: false; error: string };

/** Checks a task title. The API runs it before saving, the UI before submitting. */
export function validateTitle(input: unknown): TitleResult {
  const result = TaskTitleSchema.safeParse(input);
  if (result.success) return { ok: true, title: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Invalid title" };
}
