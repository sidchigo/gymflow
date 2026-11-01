/**
 * @file src/lib/adapters/live-adapter.ts
 * @description Production Live Adapter connecting to Upstash Redis and Live Gym API.
 */

import { type IGymflowAdapter } from "./types";
import { type AthleteState, type WeeklyWorkoutPlan, AthleteStateSchema, WeeklyWorkoutPlanSchema } from "@/types/agent";
import { type WeeklyScheduleStore, WeeklyScheduleStoreSchema } from "@/types/gym";
import {
  getRedis,
  gymTokenKey,
  athleteStateKey,
  planWeekKey,
  scheduleWeekKey,
  GYM_TOKEN_TTL,
  ATHLETE_STATE_TTL,
  PLAN_TTL,
} from "../redis";
import { getOrSyncWeeklySchedule } from "../schedule-service";

export class LiveAdapter implements IGymflowAdapter {
  readonly mode = "live" as const;

  async getAthleteState(userId: string): Promise<AthleteState | null> {
    const key = athleteStateKey(userId);
    const raw = await getRedis().get<unknown>(key);
    if (raw === null || raw === undefined) return null;

    const result = AthleteStateSchema.safeParse(raw);
    if (!result.success) {
      console.warn(`[LiveAdapter] getAthleteState: cached value for "${key}" failed schema validation:`, result.error.issues);
      return null;
    }
    return result.data;
  }

  async saveAthleteState(userId: string, state: AthleteState): Promise<void> {
    const key = athleteStateKey(userId);
    await getRedis().set(key, state, { ex: ATHLETE_STATE_TTL });
  }

  async getWeeklyWorkoutPlan(userId: string, isoWeekId: string): Promise<WeeklyWorkoutPlan | null> {
    const key = planWeekKey(userId, isoWeekId);
    const raw = await getRedis().get<unknown>(key);
    if (raw === null || raw === undefined) return null;

    const result = WeeklyWorkoutPlanSchema.safeParse(raw);
    if (!result.success) {
      console.warn(`[LiveAdapter] getWeeklyWorkoutPlan: cached value for "${key}" failed validation:`, result.error.issues);
      return null;
    }
    return result.data;
  }

  async saveWeeklyWorkoutPlan(
    userId: string,
    isoWeekId: string,
    plan: WeeklyWorkoutPlan
  ): Promise<void> {
    const key = planWeekKey(userId, isoWeekId);
    await getRedis().set(key, plan, { ex: PLAN_TTL });
  }

  async getWeeklySchedule(_userId: string, isoWeekId: string): Promise<WeeklyScheduleStore> {
    const key = scheduleWeekKey(isoWeekId);
    const raw = await getRedis().get<unknown>(key);
    if (raw) {
      const result = WeeklyScheduleStoreSchema.safeParse(raw);
      if (result.success) return result.data;
    }

    return {
      slots: [],
      diffs: [],
      lastFetchedAt: new Date().toISOString(),
    };
  }

  async syncWeeklySchedule(
    userId: string,
    options?: { forceRefresh?: boolean | undefined; targetWeekId?: string | undefined } | undefined
  ): Promise<WeeklyScheduleStore> {
    const syncResult = await getOrSyncWeeklySchedule(userId, options, /* bypassAdapter = */ true);
    return syncResult.store;
  }

  async getGymToken(userId: string): Promise<string | null> {
    return getRedis().get<string>(gymTokenKey(userId));
  }

  async storeGymToken(userId: string, token: string): Promise<void> {
    await getRedis().set(gymTokenKey(userId), token, { ex: GYM_TOKEN_TTL });
  }
}
