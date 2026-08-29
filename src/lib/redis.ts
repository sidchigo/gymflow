/**
 * @file src/lib/redis.ts
 * @spec SPEC-002 – Auth & Token Management
 *
 * Upstash Redis HTTP client.
 * All gym Bearer tokens are stored here, never in the browser.
 *
 * Key schema:  session:{userId}:gym_token  →  string (JWT Bearer)
 * TTL:         82_800 seconds (23 hours)
 *
 * `Redis.fromEnv()` reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 * from the environment automatically (Upstash SDK convention).
 */

import { Redis } from "@upstash/redis";

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
// Typed helpers
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
