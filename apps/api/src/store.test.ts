import { describe, expect, it } from "vitest";
import { createTaskStore } from "./store";

describe("createTaskStore", () => {
  it("adds tasks with increasing ids, not done", () => {
    const store = createTaskStore();

    expect(store.add("First")).toEqual({ id: "1", title: "First", done: false });
    expect(store.add("Second")).toEqual({ id: "2", title: "Second", done: false });
    expect(store.list().map((task) => task.title)).toEqual(["First", "Second"]);
  });

  it("toggles done back and forth", () => {
    const store = createTaskStore();
    const { id } = store.add("Task");

    expect(store.toggle(id)?.done).toBe(true);
    expect(store.toggle(id)?.done).toBe(false);
  });

  it("returns undefined when toggling an unknown id", () => {
    expect(createTaskStore().toggle("missing")).toBeUndefined();
  });

  it("returns copies so callers cannot change stored tasks", () => {
    const store = createTaskStore();
    store.add("Task");

    const [listed] = store.list();
    listed!.title = "Changed";

    expect(store.list()[0]?.title).toBe("Task");
  });
});
