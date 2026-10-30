import type { Task } from "@playground/shared";

export interface TaskStore {
  list(): Task[];
  add(title: string): Task;
  /** Flips `done` on the task and returns it, or `undefined` if there is no such task. */
  toggle(id: string): Task | undefined;
}

/** In-memory store. Every call to `createTaskStore` starts empty, which keeps tests isolated. */
export function createTaskStore(): TaskStore {
  const tasks: Task[] = [];
  let nextId = 1;

  return {
    list() {
      return tasks.map((task) => ({ ...task }));
    },

    add(title) {
      const task: Task = { id: String(nextId++), title, done: false };
      tasks.push(task);
      return { ...task };
    },

    toggle(id) {
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) return undefined;
      task.done = !task.done;
      return { ...task };
    },
  };
}
