/**
 * @file src/lib/fixtures/demo-athlete.ts
 * @description Pre-seeded athlete state fixture for demo sandbox.
 * Contains sample past workouts, active fatigue markers, and 5-day hybrid target.
 */

import { AthleteStateSchema, type AthleteState } from "@/types/agent";
import demoAthleteJson from "../../../fixtures/demo-athlete.json";

// Validate fixture at module load time to guarantee schema compliance
const parsed = AthleteStateSchema.safeParse(demoAthleteJson);
if (!parsed.success) {
  throw new Error(`[demo-athlete] Fixture validation failed: ${JSON.stringify(parsed.error.issues)}`);
}

export const DEMO_ATHLETE_STATE: AthleteState = parsed.data;

/**
 * Returns a fresh, deep copy of the pre-seeded demo athlete state.
 * Optionally overrides the userId (defaults to "demo-athlete").
 */
export function getDemoAthleteState(userId: string = "demo-athlete"): AthleteState {
  const cloned: AthleteState = JSON.parse(JSON.stringify(DEMO_ATHLETE_STATE));
  cloned.profile.userId = userId;
  return cloned;
}

