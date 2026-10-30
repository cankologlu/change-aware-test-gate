import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";

describe("createApp", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(createApp()).get("/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await request(createApp())
      .post("/tasks")
      .set("Content-Type", "application/json")
      .send('{"title": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON body" });
  });
});
