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
import {
  StoredPasskeyCredentialSchema,
  type StoredPasskeyCredential,
} from "@/types/webauthn";

import { isDemoMode, getAdapter } from "@/lib/adapters";

// ---------------------------------------------------------------------------
// Client & In-Memory Fallback
// ---------------------------------------------------------------------------

export interface RedisStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
}

const inMemoryDb = new Map<string, unknown>();
let cachedRedisClient: RedisStore | null = null;

export function getRedis(): RedisStore {
  if (cachedRedisClient) return cachedRedisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (
    url &&
    token &&
    url.startsWith("http") &&
    !url.includes("<your-upstash-endpoint>") &&
    !url.includes("test.upstash.io") &&
    token !== "test-token" &&
    token !== "REPLACE_WITH_UPSTASH_TOKEN" &&
    process.env.NODE_ENV !== "test"
  ) {
    try {
      const client = new Redis({ url, token });
      cachedRedisClient = client as unknown as RedisStore;
      return cachedRedisClient;
    } catch (e) {
      console.warn("[Redis] Failed to initialize Upstash client, using in-memory store:", e);
    }
  }

  // Fallback in-memory store for local testing & development
  cachedRedisClient = {
    async get<T = unknown>(key: string): Promise<T | null> {
      const val = inMemoryDb.get(key);
      if (val === undefined || val === null) return null;
      return val as T;
    },
    async set(key: string, value: unknown): Promise<"OK" | null> {
      inMemoryDb.set(key, value);
      return "OK";
    },
    async del(key: string): Promise<number> {
      return inMemoryDb.delete(key) ? 1 : 0;
    },
  };

  return cachedRedisClient;
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
  if (isDemoMode()) {
    return getAdapter().storeGymToken(userId, token);
  }
  await getRedis().set(gymTokenKey(userId), token, { ex: GYM_TOKEN_TTL });
}

/**
 * Retrieve a stored gym Bearer token.
 * Returns `null` if the key does not exist or has expired.
 */
export async function getGymToken(userId: string): Promise<string | null> {
  if (isDemoMode()) {
    return getAdapter().getGymToken(userId);
  }
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
  if (isDemoMode()) {
    return getAdapter().getAthleteState(userId);
  }
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
  if (isDemoMode()) {
    return getAdapter().saveAthleteState(userId, state);
  }
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
  if (isDemoMode()) {
    return getAdapter().getWeeklyWorkoutPlan(userId, isoWeekId);
  }
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
  if (isDemoMode()) {
    return getAdapter().saveWeeklyWorkoutPlan(userId, isoWeekId, plan);
  }
  const key = planWeekKey(userId, isoWeekId);
  await getRedis().set(key, plan, { ex: PLAN_TTL });
}

// ---------------------------------------------------------------------------
// Telegram Chat Mapping Helpers
// ---------------------------------------------------------------------------

export async function linkTelegramChat(chatId: string | number, userId: string): Promise<void> {
  await getRedis().set(`telegram:chat:${chatId}:user`, userId);
  await getRedis().set(`telegram:user:${userId}:chat`, String(chatId));
}

export async function getUserIdByTelegramChat(chatId: string | number): Promise<string | null> {
  return getRedis().get<string>(`telegram:chat:${chatId}:user`);
}

export async function getTelegramChatByUserId(userId: string): Promise<string | null> {
  return getRedis().get<string>(`telegram:user:${userId}:chat`);
}

// ---------------------------------------------------------------------------
// WebAuthn Passkey Credentials Helpers
// ---------------------------------------------------------------------------

export const WEBAUTHN_CHALLENGE_TTL = 300; // 5 minutes

export async function storeWebAuthnChallenge(
  key: string,
  challenge: string,
  ttlSeconds = WEBAUTHN_CHALLENGE_TTL
): Promise<void> {
  await getRedis().set(`webauthn:challenge:${key}`, challenge, { ex: ttlSeconds });
}

export async function getAndClearWebAuthnChallenge(key: string): Promise<string | null> {
  const redisKey = `webauthn:challenge:${key}`;
  const challenge = await getRedis().get<string>(redisKey);
  if (challenge) {
    await getRedis().del(redisKey);
  }
  return challenge;
}

export async function savePasskeyCredential(
  credential: StoredPasskeyCredential
): Promise<void> {
  const credKey = `passkey:credential:${credential.credentialId}`;
  await getRedis().set(credKey, credential);

  const userPasskeysKey = `user:${credential.userId}:passkeys`;
  const existingIds = (await getRedis().get<string[]>(userPasskeysKey)) || [];
  if (!existingIds.includes(credential.credentialId)) {
    existingIds.push(credential.credentialId);
    await getRedis().set(userPasskeysKey, existingIds);
  }
}

export async function getPasskeyCredential(
  credentialId: string
): Promise<StoredPasskeyCredential | null> {
  const credKey = `passkey:credential:${credentialId}`;
  const raw = await getRedis().get<unknown>(credKey);
  if (!raw) return null;
  const parsed = StoredPasskeyCredentialSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function getUserPasskeys(
  userId: string
): Promise<StoredPasskeyCredential[]> {
  const userPasskeysKey = `user:${userId}:passkeys`;
  const credentialIds = (await getRedis().get<string[]>(userPasskeysKey)) || [];
  const credentials: StoredPasskeyCredential[] = [];

  for (const id of credentialIds) {
    const cred = await getPasskeyCredential(id);
    if (cred) {
      credentials.push(cred);
    }
  }

  return credentials;
}

export async function deletePasskeyCredential(
  userId: string,
  credentialId: string
): Promise<void> {
  const credKey = `passkey:credential:${credentialId}`;
  await getRedis().del(credKey);

  const userPasskeysKey = `user:${userId}:passkeys`;
  const existingIds = (await getRedis().get<string[]>(userPasskeysKey)) || [];
  const updatedIds = existingIds.filter((id) => id !== credentialId);
  await getRedis().set(userPasskeysKey, updatedIds);
}

export async function deleteUserPasskeys(userId: string): Promise<void> {
  const userPasskeysKey = `user:${userId}:passkeys`;
  const existingIds = (await getRedis().get<string[]>(userPasskeysKey)) || [];
  for (const id of existingIds) {
    await getRedis().del(`passkey:credential:${id}`);
  }
  await getRedis().del(userPasskeysKey);
}


