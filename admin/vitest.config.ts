import { defineConfig, mergeConfig } from "vitest/config";
import vite from "./vite.config";
export default mergeConfig(
  vite,
  defineConfig({ test: { testTimeout: 15000, fileParallelism: false } }),
);
