import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "@playground/shared";
import type { TaskApi } from "./api";
import { App } from "./App";

/** An in-memory stand-in for the HTTP API. */
function fakeApi(initial: Task[] = []) {
  let tasks = [...initial];
  let nextId = tasks.length + 1;

  return {
    list: vi.fn(async () => tasks),
    add: vi.fn(async (title: string) => {
      const task = { id: String(nextId++), title, done: false };
      tasks = [...tasks, task];
      return task;
    }),
    toggle: vi.fn(async (id: string) => {
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) throw new Error("Task not found");
      const updated = { ...task, done: !task.done };
      tasks = tasks.map((candidate) => (candidate.id === id ? updated : candidate));
      return updated;
    }),
  } satisfies TaskApi;
}

describe("App", () => {
  it("shows the tasks from the API", async () => {
    render(<App api={fakeApi([{ id: "1", title: "Buy milk", done: true }])} />);

    const checkbox = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Buy milk" });
    expect(checkbox.checked).toBe(true);
  });

  it("shows an empty state when there are no tasks", async () => {
    render(<App api={fakeApi()} />);

    expect(await screen.findByText("No tasks yet.")).toBeDefined();
  });

  it("adds a task and clears the input", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<App api={api} />);
    await screen.findByText("No tasks yet.");

    await user.type(screen.getByLabelText("New task"), "Write tests");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("checkbox", { name: "Write tests" })).toBeDefined();
    expect(api.add).toHaveBeenCalledWith("Write tests");
    expect(screen.getByLabelText<HTMLInputElement>("New task").value).toBe("");
  });

  it("shows a validation error instead of calling the API for a blank title", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<App api={api} />);
    await screen.findByText("No tasks yet.");

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Title is required");
    expect(api.add).not.toHaveBeenCalled();
  });

  it("toggles a task", async () => {
    const user = userEvent.setup();
    const api = fakeApi([{ id: "1", title: "Buy milk", done: false }]);
    render(<App api={api} />);

    await user.click(await screen.findByRole("checkbox", { name: "Buy milk", checked: false }));

    expect(await screen.findByRole("checkbox", { name: "Buy milk", checked: true })).toBeDefined();
    expect(api.toggle).toHaveBeenCalledWith("1");
  });
});
