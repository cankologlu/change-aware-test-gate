import { Router } from "express";
import { validateTitle } from "@playground/shared";
import type { TaskStore } from "../store";

export function tasksRouter(store: TaskStore): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(store.list());
  });

  router.post("/", (req, res) => {
    const result = validateTitle(req.body?.title);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json(store.add(result.title));
  });

  router.patch("/:id", (req, res) => {
    const task = store.toggle(req.params.id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(task);
  });

  return router;
}
