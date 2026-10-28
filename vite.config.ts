import { defineConfig } from "vite";

export default defineConfig({
  server: {
    watch: {
      // Packaging output and production builds are not source files; watching
      // them causes spurious full-page reloads during verification.
      ignored: ["**/release/**", "**/dist/**"],
    },
  },
});
