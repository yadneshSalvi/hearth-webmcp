import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // One worker: every spec drives the same WebGL studio, and parallel pages starve each other's
  // render loop — a `frameloop="demand"` canvas that never gets a frame never yields a capture.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  // Two projects, in this order, because each one gets its own browser: the wow specs photograph the
  // canvas, and after a dozen studio pages in one browser Chromium stops mounting the R3F tree (the
  // GLB/HDRI loaders never resolve), so a capture would wait for a frame that never comes.
  projects: [
    // One retry, even locally: a capture depends on the software renderer producing a frame, which a
    // loaded machine occasionally will not do inside the deadline.
    { name: "captures", testMatch: /wow-a\.spec\.ts$/, retries: 1, use: { ...devices["Desktop Chrome"] } },
    { name: "chromium", testIgnore: /wow-a\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm dev --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
