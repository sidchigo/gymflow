/**
 * @file src/lib/adapters/types.ts
 * @description Provider / Adapter abstraction interface for gym timetable fetching and user state storage.
 */

import { type AthleteState, type WeeklyWorkoutPlan } from "@/types/agent";
import { type WeeklyScheduleStore } from "@/types/gym";

export interface IGymflowAdapter {
  readonly mode: "live" | "demo";

  // Athlete State Store
  getAthleteState(userId: string): Promise<AthleteState | null>;
  saveAthleteState(userId: string, state: AthleteState): Promise<void>;

  // Weekly Workout Plan Store
  getWeeklyWorkoutPlan(userId: string, isoWeekId: string): Promise<WeeklyWorkoutPlan | null>;
  saveWeeklyWorkoutPlan(userId: string, isoWeekId: string, plan: WeeklyWorkoutPlan): Promise<void>;

  // Timetable & Schedule Store
  getWeeklySchedule(userId: string, isoWeekId: string): Promise<WeeklyScheduleStore>;
  syncWeeklySchedule(
    userId: string,
    options?: { forceRefresh?: boolean | undefined; targetWeekId?: string | undefined } | undefined
  ): Promise<WeeklyScheduleStore>;

  // Gym Token Management
  getGymToken(userId: string): Promise<string | null>;
  storeGymToken(userId: string, token: string): Promise<void>;

  // Sandbox State Management
  resetDemoState?(): Promise<void>;
}
