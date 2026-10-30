import express, { type ErrorRequestHandler } from "express";
import { createTaskStore, type TaskStore } from "./store";
import { tasksRouter } from "./routes/tasks";

export function createApp(store: TaskStore = createTaskStore()) {
  const app = express();

  app.use(express.json());
  app.use("/tasks", tasksRouter(store));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const handleErrors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(handleErrors);

  return app;
}
