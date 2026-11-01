/**
 * @file src/lib/adapters/index.ts
 * @description Adapter factory and environment mode resolution for Gymflow.
 */

import { type IGymflowAdapter } from "./types";
import { MockDemoAdapter } from "./mock-demo-adapter";
import { LiveAdapter } from "./live-adapter";

export * from "./types";
export * from "./mock-demo-adapter";
export * from "./live-adapter";

let demoModeOverride: boolean | null = null;
let cachedMockDemoAdapter: MockDemoAdapter | null = null;
let cachedLiveAdapter: LiveAdapter | null = null;

/**
 * Checks whether Gymflow is currently operating in public demo/sandbox mode.
 * Evaluates `NEXT_PUBLIC_DEMO_MODE` and `DEMO_MODE` environment variables.
 */
export function isDemoMode(): boolean {
  if (demoModeOverride !== null) {
    return demoModeOverride;
  }
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
    process.env.DEMO_MODE === "true"
  );
}

/**
 * Allows unit tests or runtime harnesses to programmatically force demo mode on or off.
 * Pass `null` to revert to environment variable evaluation.
 */
export function setDemoModeOverride(enabled: boolean | null): void {
  demoModeOverride = enabled;
}

/**
 * Returns the active adapter instance based on runtime mode:
 * - Demo mode active → `MockDemoAdapter` (in-memory fixtures, no Redis/external gym API needed)
 * - Otherwise        → `LiveAdapter` (Upstash Redis + live gym timetable)
 */
export function getAdapter(): IGymflowAdapter {
  if (isDemoMode()) {
    if (!cachedMockDemoAdapter) {
      cachedMockDemoAdapter = new MockDemoAdapter();
    }
    return cachedMockDemoAdapter;
  }

  if (!cachedLiveAdapter) {
    cachedLiveAdapter = new LiveAdapter();
  }
  return cachedLiveAdapter;
}

