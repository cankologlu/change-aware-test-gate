import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";

describe("GET /tasks", () => {
  it("starts with an empty list", async () => {
    const res = await request(createApp()).get("/tasks");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /tasks", () => {
  it("creates a task with a trimmed title", async () => {
    const app = createApp();

    const res = await request(app).post("/tasks").send({ title: "  Buy milk  " });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), title: "Buy milk", done: false });

    const list = await request(app).get("/tasks");
    expect(list.body).toEqual([res.body]);
  });

  it("rejects a missing title", async () => {
    const res = await request(createApp()).post("/tasks").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Title is required");
  });

  it("rejects a blank title", async () => {
    const res = await request(createApp()).post("/tasks").send({ title: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Title is required");
  });

  it("accepts a title of 100 characters", async () => {
    const res = await request(createApp()).post("/tasks").send({ title: "a".repeat(100) });

    expect(res.status).toBe(201);
  });

  it("rejects a title longer than 100 characters", async () => {
    const res = await request(createApp()).post("/tasks").send({ title: "a".repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Title must be at most 100 characters");
  });
});

describe("PATCH /tasks/:id", () => {
  it("toggles done", async () => {
    const app = createApp();
    const { body: task } = await request(app).post("/tasks").send({ title: "Write tests" });

    const first = await request(app).patch(`/tasks/${task.id}`);
    expect(first.status).toBe(200);
    expect(first.body.done).toBe(true);

    const second = await request(app).patch(`/tasks/${task.id}`);
    expect(second.status).toBe(200);
    expect(second.body.done).toBe(false);
  });

  it("returns 404 for an unknown task", async () => {
    const res = await request(createApp()).patch("/tasks/999");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Task not found");
  });
});
