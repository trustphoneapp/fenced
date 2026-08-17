import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@zintus-continuity/adapters-local": fileURLToPath(
        new URL("./packages/adapters-local/src/index.ts", import.meta.url),
      ),
      "@zintus-continuity/application/internal/local-c02-authority-registrar": fileURLToPath(
        new URL(
          "./packages/application/src/internal/local-c02-authority-registrar.ts",
          import.meta.url,
        ),
      ),
      "@zintus-continuity/application": fileURLToPath(
        new URL("./packages/application/src/index.ts", import.meta.url),
      ),
      "@zintus-continuity/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@zintus-continuity/domain": fileURLToPath(
        new URL("./packages/domain/src/index.ts", import.meta.url),
      ),
      "@zintus-continuity/foundation/safe-data-access": fileURLToPath(
        new URL("./packages/foundation/src/safe-data-access.ts", import.meta.url),
      ),
      "@zintus-continuity/foundation/owned-json": fileURLToPath(
        new URL("./packages/foundation/src/owned-json.ts", import.meta.url),
      ),
      "@zintus-continuity/foundation": fileURLToPath(
        new URL("./packages/foundation/src/index.ts", import.meta.url),
      ),
      "@zintus-continuity/policy": fileURLToPath(
        new URL("./packages/policy/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    exclude: ["tests/hackathon/h20-public-export.test.mjs"],
    include: ["tests/**/*.test.{mjs,ts}"],
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
