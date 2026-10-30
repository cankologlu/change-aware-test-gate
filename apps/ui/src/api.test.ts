import { afterEach, describe, expect, it, vi } from "vitest";
import { httpTaskApi } from "./api";

const task = { id: "1", title: "Buy milk", done: false };

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpTaskApi", () => {
  it("lists tasks", async () => {
    const fetchMock = mockFetch(200, [task]);

    await expect(httpTaskApi.list()).resolves.toEqual([task]);
    expect(fetchMock).toHaveBeenCalledWith("/tasks", expect.anything());
  });

  it("creates a task with POST", async () => {
    const fetchMock = mockFetch(201, task);

    await expect(httpTaskApi.add("Buy milk")).resolves.toEqual(task);
    expect(fetchMock).toHaveBeenCalledWith(
      "/tasks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Buy milk" }) }),
    );
  });

  it("toggles a task with PATCH", async () => {
    const fetchMock = mockFetch(200, { ...task, done: true });

    await expect(httpTaskApi.toggle("1")).resolves.toEqual({ ...task, done: true });
    expect(fetchMock).toHaveBeenCalledWith("/tasks/1", expect.objectContaining({ method: "PATCH" }));
  });

  it("throws the error message the API sends back", async () => {
    mockFetch(400, { error: "Title is required" });

    await expect(httpTaskApi.add("")).rejects.toThrow("Title is required");
  });
});
