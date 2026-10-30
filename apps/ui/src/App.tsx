import { useEffect, useState, type FormEvent } from "react";
import { validateTitle, type Task } from "@playground/shared";
import { httpTaskApi, type TaskApi } from "./api";

export function App({ api = httpTaskApi }: { api?: TaskApi }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.list().then(setTasks, (err: Error) => setError(err.message));
  }, [api]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    const result = validateTitle(title);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    try {
      const task = await api.add(result.title);
      setTasks((current) => [...(current ?? []), task]);
      setTitle("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleTask(id: string) {
    try {
      const updated = await api.toggle(id);
      setTasks((current) => current?.map((task) => (task.id === id ? updated : task)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main>
      <h1>Tasks</h1>

      <form onSubmit={addTask}>
        <label>
          New task
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <button type="submit">Add</button>
      </form>

      {error && <p role="alert">{error}</p>}

      {tasks === null && <p>Loading…</p>}
      {tasks?.length === 0 && <p>No tasks yet.</p>}
      {tasks && tasks.length > 0 && (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <label>
                <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
                {task.title}
              </label>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
