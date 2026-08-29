/**
 * @file src/lib/redis.ts
 * @spec SPEC-002 – Auth & Token Management
 * @spec SPEC-003 – Schedule Ingestion & Dynamic Diffing
 *
 * Upstash Redis HTTP client.
 * All gym Bearer tokens are stored here, never in the browser.
 *
 * Key schema:  session:{userId}:gym_token           →  string (JWT Bearer)  TTL: 82_800 s
 *              schedule:week:{year}_W{weekNumber}   →  WeeklyScheduleStore  TTL: 604_800 s
 *
 * `Redis.fromEnv()` reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 * from the environment automatically (Upstash SDK convention).
 */

import { Redis } from "@upstash/redis";
import {
  WeeklyScheduleStoreSchema,
  type WeeklyScheduleStore,
} from "@/types/gym";
import {
  AthleteStateSchema,
  WeeklyWorkoutPlanSchema,
  type AthleteState,
  type WeeklyWorkoutPlan,
} from "@/types/agent";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Module-level Redis client initialised via `Redis.fromEnv()`.
 * The Upstash SDK reads `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` automatically and throws if either is absent.
 *
 * In mock mode (`GYM_USE_MOCK=true`) this module is imported but the helper
 * functions below are never called, so missing env vars won't cause a crash.
 */
const redis = Redis.fromEnv();

/** Exposed for the rare case where a route needs the raw client. */
export function getRedis(): Redis {
  return redis;
}

// ---------------------------------------------------------------------------
// Auth token helpers (SPEC-002)
// ---------------------------------------------------------------------------

/** TTL for all gym session tokens: 23 hours (safely within 24-hour gym expiry) */
export const GYM_TOKEN_TTL = 82_800;

/** Redis key for a user's gym Bearer token. */
export function gymTokenKey(userId: string): string {
  return `session:${userId}:gym_token`;
}

/**
 * Write a gym Bearer token to Redis with the standard 23-hour TTL.
 * Overwrites any existing value for the same userId.
 */
export async function storeGymToken(
  userId: string,
  token: string,
): Promise<void> {
  await getRedis().set(gymTokenKey(userId), token, { ex: GYM_TOKEN_TTL });
}

/**
 * Retrieve a stored gym Bearer token.
 * Returns `null` if the key does not exist or has expired.
 */
export async function getGymToken(userId: string): Promise<string | null> {
  return getRedis().get<string>(gymTokenKey(userId));
}

// ---------------------------------------------------------------------------
// Weekly schedule store helpers (SPEC-003)
// ---------------------------------------------------------------------------

/** TTL for the weekly schedule store: 7 days per spec. */
export const SCHEDULE_TTL = 604_800;

/**
 * Redis key for a weekly schedule store.
 * @param isoWeekId - e.g. "2026_W35"
 */
export function scheduleWeekKey(isoWeekId: string): string {
  return `schedule:week:${isoWeekId}`;
}

/**
 * Read a weekly schedule store from Redis.
 * Returns `null` if the key does not exist or has expired.
 * Validates the stored value against {@link WeeklyScheduleStoreSchema}; if
 * the shape is unexpected (e.g. after a schema migration) it returns `null`
 * rather than crashing.
 */
export async function getWeeklyStore(
  key: string,
): Promise<WeeklyScheduleStore | null> {
  const raw = await getRedis().get<unknown>(key);
  if (raw === null || raw === undefined) return null;

  const result = WeeklyScheduleStoreSchema.safeParse(raw);
  if (!result.success) {
    console.warn(
      `[redis] getWeeklyStore: cached value for "${key}" failed schema validation – treating as cache miss.`,
      result.error.issues,
    );
    return null;
  }

  return result.data;
}

/**
 * Persist a weekly schedule store to Redis with the standard 7-day TTL.
 * Overwrites any existing value at the given key.
 */
export async function saveWeeklyStore(
  key: string,
  store: WeeklyScheduleStore,
): Promise<void> {
  await getRedis().set(key, store, { ex: SCHEDULE_TTL });
}

// ---------------------------------------------------------------------------
// Athlete consolidated state and user plan helpers (SPEC-004)
// ---------------------------------------------------------------------------

/** TTL for athlete state: 90 days (per spec) */
export const ATHLETE_STATE_TTL = 90 * 24 * 60 * 60; // 7,776,000 seconds

/** TTL for weekly workout plans: 14 days (per spec, scoped to user) */
export const PLAN_TTL = 14 * 24 * 60 * 60; // 1,209,600 seconds

export function athleteStateKey(userId: string): string {
  return `athlete:state:${userId}`;
}

export function planWeekKey(userId: string, isoWeekId: string): string {
  return `plan:${userId}:${isoWeekId}`;
}

/**
 * Retrieve consolidated athlete state (profile, lift history, event logs).
 * Returns null if the user does not exist or has expired.
 */
export async function getAthleteState(
  userId: string,
): Promise<AthleteState | null> {
  const key = athleteStateKey(userId);
  const raw = await getRedis().get<unknown>(key);
  if (raw === null || raw === undefined) return null;

  const result = AthleteStateSchema.safeParse(raw);
  if (!result.success) {
    console.warn(
      `[redis] getAthleteState: cached value for "${key}" failed schema validation – treating as cache miss.`,
      result.error.issues,
    );
    return null;
  }

  return result.data;
}

/**
 * Persist consolidated athlete state (profile, lift history, event logs) with 90-day TTL.
 */
export async function saveAthleteState(
  userId: string,
  state: AthleteState,
): Promise<void> {
  const key = athleteStateKey(userId);
  await getRedis().set(key, state, { ex: ATHLETE_STATE_TTL });
}

/**
 * Retrieve user-scoped weekly workout plan.
 */
export async function getWeeklyWorkoutPlan(
  userId: string,
  isoWeekId: string,
): Promise<WeeklyWorkoutPlan | null> {
  const key = planWeekKey(userId, isoWeekId);
  const raw = await getRedis().get<unknown>(key);
  if (raw === null || raw === undefined) return null;

  const result = WeeklyWorkoutPlanSchema.safeParse(raw);
  if (!result.success) {
    console.warn(
      `[redis] getWeeklyWorkoutPlan: cached value for "${key}" failed schema validation – treating as cache miss.`,
      result.error.issues,
    );
    return null;
  }

  return result.data;
}

/**
 * Persist user-scoped weekly workout plan with 14-day TTL.
 */
export async function saveWeeklyWorkoutPlan(
  userId: string,
  isoWeekId: string,
  plan: WeeklyWorkoutPlan,
): Promise<void> {
  const key = planWeekKey(userId, isoWeekId);
  await getRedis().set(key, plan, { ex: PLAN_TTL });
}

