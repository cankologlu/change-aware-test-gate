import type { Task } from "@playground/shared";

export interface TaskApi {
  list(): Promise<Task[]>;
  add(title: string): Promise<Task>;
  toggle(id: string): Promise<Task>;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

/** Calls the API through the Vite dev server proxy (see vite.config.ts). */
export const httpTaskApi: TaskApi = {
  list: () => request<Task[]>("/tasks"),
  add: (title) => request<Task>("/tasks", { method: "POST", body: JSON.stringify({ title }) }),
  toggle: (id) => request<Task>(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH" }),
};
