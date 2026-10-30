import { defineConfig } from "vitest/config";

// No React plugin needed: Vite compiles JSX itself, using `"jsx": "react-jsx"` from tsconfig.json.
export default defineConfig({
  server: {
    // The API runs on its own port; the dev server forwards /tasks to it.
    proxy: { "/tasks": "http://localhost:3001" },
  },
  test: {
    environment: "jsdom",
    // Lets Testing Library clean up the DOM after each test.
    globals: true,
  },
});
