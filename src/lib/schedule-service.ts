/**
 * @file src/lib/schedule-service.ts
 * @spec SPEC-003 – Schedule Ingestion & Dynamic Diffing
 *
 * Pure, server-only service that encapsulates the full schedule sync pipeline:
 *   1. Derive the Redis key for the current ISO week.
 *   2. Fetch raw schedule from the gym API and normalise it.
 *   3. Load any existing cached store from Redis.
 *   4. Compute diffs (CANCELLED / RESCHEDULED / NEW) for future slots only.
 *   5. Merge incoming slots over the existing store, preserving past days.
 *   6. Persist the merged store back to Redis.
 *
 * CRITICAL invariants (per spec):
 *   - All timestamps and date strings MUST use Asia/Kolkata (IST / UTC+5:30).
 *   - Past days are NEVER wiped; only future slots are diffed and replaced.
 *   - A single Redis key holds the full Monday–Sunday week state.
 *
 * The `computeDiffs` and `mergeWeeklyStore` functions have no side effects and
 * are exported for unit-testing in isolation.
 */

import {
  normalizeSchedulePayload,
  type NormalizedGymSlot,
  type ScheduleDiff,
  type WeeklyScheduleStore,
} from "@/types/gym";
import {
  getGymToken,
  getWeeklyStore,
  saveWeeklyStore,
  scheduleWeekKey,
} from "@/lib/redis";
import { getGymClient, GymUnavailableError } from "@/lib/gym-client";

// ---------------------------------------------------------------------------
// IST timezone constant
// ---------------------------------------------------------------------------

const IST_TZ = "Asia/Kolkata";

// ---------------------------------------------------------------------------
// Week-key derivation
// ---------------------------------------------------------------------------


/**
 * Returns the current ISO week number (1–53) for a given date, using the
 * standard ISO 8601 definition (Monday = first day of week, week containing
 * the first Thursday is week 1).
 */
function isoWeekNumber(date: Date): number {
  // Clone and normalise to the nearest Thursday (ISO week anchor).
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  // Set to nearest Thursday: current date + 4 - current day number (Mon=1)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Derives the Redis key segment (`YYYY_Www`) for the week containing the
 * supplied date, using IST for date calculation.
 *
 * @example weekKey(new Date()) → "2026_W35"
 */
export function weekKey(date: Date): string {
  // Convert to IST to get the correct local date for week calculation.
  const istDateStr = date.toLocaleDateString("en-CA", { timeZone: IST_TZ });
  const [year, month, day] = istDateStr.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const istDate = new Date(Date.UTC(year, month - 1, day));
  const week = isoWeekNumber(istDate);
  // Use the year of the Thursday anchor, not necessarily the input year.
  const thursdayDate = new Date(istDate);
  thursdayDate.setUTCDate(istDate.getUTCDate() + 4 - (istDate.getUTCDay() || 7));
  const weekYear = thursdayDate.getUTCFullYear();
  return `${weekYear}_W${String(week).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// IST timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current moment as an ISO 8601 string in IST offset notation
 * (e.g. "2026-08-29T12:00:00.000+05:30"). Used for `lastFetchedAt` and
 * diff `detectedAt` fields.
 */
export function nowIST(): string {
  const istDate = new Date().toLocaleDateString("en-CA", { timeZone: IST_TZ });
  const istTime = new Date().toLocaleTimeString("en-GB", {
    timeZone: IST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${istDate}T${istTime}+05:30`;
}

/**
 * Returns the current IST date+time as a `YYYY-MM-DDTHH:MM` string.
 *
 * This format is directly lexicographically comparable with the slot
 * datetime strings produced by `${slot.date}T${slot.startTime}`, making
 * it safe to determine whether a slot has already started without any
 * date-library dependency.
 *
 * **Why datetime and not just date?**
 * The gym API only returns slots from the *current timestamp* onwards —
 * e.g. if it is 18:30 IST it will not include a 07:00 session that already
 * happened today. Using a date-only cutoff would cause those already-started
 * same-day slots to be incorrectly flagged as CANCELLED and then dropped from
 * the merged store. The datetime cutoff treats them as past and preserves them.
 */
export function nowISTDateTime(): string {
  const istDate = new Date().toLocaleDateString("en-CA", { timeZone: IST_TZ }); // YYYY-MM-DD
  const istTime = new Date().toLocaleTimeString("en-GB", {
    timeZone: IST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }); // HH:MM
  return `${istDate}T${istTime}`;
}

// ---------------------------------------------------------------------------
// Diffing logic
// ---------------------------------------------------------------------------

/**
 * Returns true when a slot has NOT yet started relative to `nowDateTime`.
 *
 * Comparison is performed on `YYYY-MM-DDTHH:MM` strings which are
 * lexicographically ordered, so no date parsing is required.
 */
function isSlotFuture(slot: NormalizedGymSlot, nowDateTime: string): boolean {
  return `${slot.date}T${slot.startTime}` > nowDateTime;
}

/**
 * Compares a fresh schedule payload against the existing cached snapshot and
 * emits diff events for changes to **not-yet-started** slots only.
 *
 * Rules:
 * - **CANCELLED**: a cached future slot whose `id` is absent from `incoming`.
 * - **RESCHEDULED**: same `id` present in both, but `startTime` differs.
 * - **NEW**: a slot in `incoming` whose `id` was not in the cache at all.
 *
 * **Why `nowDateTime` instead of `todayDate`?**
 * The gym API only returns slots from the current timestamp onwards. A session
 * at 07:00 that completed by 18:30 will not appear in the fresh payload — but
 * it was never *cancelled*. Using a date-only cutoff would produce a false
 * CANCELLED diff for it. Using a datetime cutoff (`YYYY-MM-DDTHH:MM` in IST)
 * correctly classifies already-started sessions as past and skips them.
 *
 * @param cached - Previously stored slots (may be empty on first run).
 * @param incoming - Freshly normalised slots from the gym API.
 * @param nowDateTime - Current IST moment as `YYYY-MM-DDTHH:MM`.
 * @param detectedAt - ISO 8601 IST timestamp to stamp on generated diffs.
 */
export function computeDiffs(
  cached: NormalizedGymSlot[],
  incoming: NormalizedGymSlot[],
  nowDateTime: string,
  detectedAt: string,
): ScheduleDiff[] {
  const diffs: ScheduleDiff[] = [];

  // Index incoming by slot ID for O(1) lookups.
  const incomingById = new Map<string, NormalizedGymSlot>(
    incoming.map((s) => [s.id, s]),
  );
  const cachedById = new Map<string, NormalizedGymSlot>(
    cached.map((s) => [s.id, s]),
  );

  // 1. Detect CANCELLED and RESCHEDULED from the cached not-yet-started slots.
  for (const cachedSlot of cached) {
    // Skip already-started/past sessions — the gym API won't include them
    // in the fresh payload (it cuts off at the current timestamp), so their
    // absence does NOT indicate a cancellation.
    if (!isSlotFuture(cachedSlot, nowDateTime)) continue;

    const freshSlot = incomingById.get(cachedSlot.id);

    if (freshSlot === undefined) {
      // Slot was in cache but is gone from the fresh payload → CANCELLED.
      diffs.push({
        type: "CANCELLED",
        slotId: cachedSlot.id,
        title: cachedSlot.title,
        date: cachedSlot.date,
        originalTime: cachedSlot.startTime,
        updatedTime: null,
        detectedAt,
      });
    } else if (freshSlot.startTime !== cachedSlot.startTime) {
      // Same slot ID but time has shifted → RESCHEDULED.
      diffs.push({
        type: "RESCHEDULED",
        slotId: cachedSlot.id,
        title: cachedSlot.title,
        date: cachedSlot.date,
        originalTime: cachedSlot.startTime,
        updatedTime: freshSlot.startTime,
        detectedAt,
      });
    }
  }

  // 2. Detect NEW slots present in incoming but absent from cache entirely.
  for (const freshSlot of incoming) {
    // Only flag future slots as new.
    if (!isSlotFuture(freshSlot, nowDateTime)) continue;
    if (!cachedById.has(freshSlot.id)) {
      diffs.push({
        type: "NEW",
        slotId: freshSlot.id,
        title: freshSlot.title,
        date: freshSlot.date,
        originalTime: freshSlot.startTime,
        updatedTime: null,
        detectedAt,
      });
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

/**
 * Merges a fresh schedule payload into the existing weekly store, honouring
 * the Full Week Retention invariant:
 *
 * - Already-started slots (`${date}T${startTime}` ≤ `nowDateTime`) are always
 *   taken from `cached.slots`, because the gym API no longer returns them.
 * - Not-yet-started slots are replaced wholesale with `incoming` data.
 * - Newly computed diffs are **appended** to the existing diff log.
 *
 * If `cached` is `null` (first sync of the week), all `incoming` slots are
 * stored and `diffs` is set to `[]`.
 *
 * @param cached - Existing store from Redis, or `null` on first sync.
 * @param incoming - Freshly normalised slots from the gym API.
 * @param nowDateTime - Current IST moment as `YYYY-MM-DDTHH:MM`.
 * @param fetchedAt - ISO 8601 IST timestamp for `lastFetchedAt`.
 * @param detectedAt - ISO 8601 IST timestamp for diff `detectedAt` field.
 */
export function mergeWeeklyStore(
  cached: WeeklyScheduleStore | null,
  incoming: NormalizedGymSlot[],
  nowDateTime: string,
  fetchedAt: string,
  detectedAt: string,
): WeeklyScheduleStore {
  if (cached === null) {
    // First sync — store everything as-is, no diffs.
    return {
      lastFetchedAt: fetchedAt,
      slots: incoming,
      diffs: [],
    };
  }

  // Compute new diffs against the current cache.
  const newDiffs = computeDiffs(cached.slots, incoming, nowDateTime, detectedAt);

  // Retain already-started slots from the cache verbatim. The gym API won't
  // return them any more, so we must preserve them ourselves.
  const pastSlots = cached.slots.filter((s) => !isSlotFuture(s, nowDateTime));

  // Replace not-yet-started slots with the fresh data.
  const futureSlots = incoming.filter((s) => isSlotFuture(s, nowDateTime));

  return {
    lastFetchedAt: fetchedAt,
    slots: [...pastSlots, ...futureSlots],
    diffs: [...cached.diffs, ...newDiffs],
  };
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

/**
 * Executes the full SPEC-003 schedule sync pipeline for the authenticated user:
 *
 * 1. Reads gym Bearer token from Redis.
 * 2. Fetches fresh schedule from gym API and normalises it.
 * 3. Loads existing weekly store from Redis.
 * 4. Computes diffs and merges into the existing store.
 * 5. Persists the merged store back to Redis.
 *
 * @param userId - Authenticated user ID (from session cookie).
 * @returns The merged `WeeklyScheduleStore` ready to return to the client.
 *
 * @throws {{ code: "GYM_TOKEN_EXPIRED" }} when the gym Bearer token is missing.
 * @throws {{ code: "GYM_UNAVAILABLE", staleStore: WeeklyScheduleStore }}
 *         when the gym API is unreachable AND a stale cache exists. The caller
 *         should surface the stale data with a warning header.
 */
export async function fetchAndSync(userId: string): Promise<WeeklyScheduleStore> {
  const tag = `[schedule-service] userId=${userId}`;

  // ── 1. Resolve gym token ─────────────────────────────────────────────────
  const gymToken = await getGymToken(userId);
  if (!gymToken) {
    console.warn(`${tag} gym token missing or expired`);
    throw { code: "GYM_TOKEN_EXPIRED" as const };
  }

  // ── 2. Determine week key & load existing cache ──────────────────────────
  const now = new Date();
  const key = scheduleWeekKey(weekKey(now));
  // Capture the IST datetime *once* so that computeDiffs and mergeWeeklyStore
  // use a consistent cutoff even if the sync takes a few seconds.
  const nowDT = nowISTDateTime(); // "YYYY-MM-DDTHH:MM" IST
  const fetchedAt = nowIST();     // ISO 8601 for metadata
  const detectedAt = fetchedAt;

  console.info(`${tag} syncing week key="${key}" nowIST="${nowDT}"`);

  const cached = await getWeeklyStore(key);

  // ── 3. Fetch from gym API ────────────────────────────────────────────────
  // NOTE: The gym API returns slots from the *current timestamp* forward only.
  // Sessions that have already started (e.g. 07:00 KB when it is now 18:30)
  // will not appear in the response. This is expected and handled by using
  // `nowDT` as the cutoff in both computeDiffs and mergeWeeklyStore.
  let incoming: NormalizedGymSlot[];
  try {
    const client = await getGymClient();
    const raw = await client.getSchedule(gymToken);
    incoming = normalizeSchedulePayload(raw);
    console.info(`${tag} fetched ${incoming.length} slots from gym API`);
  } catch (err) {
    if (err instanceof GymUnavailableError) {
      if (cached !== null) {
        console.warn(`${tag} gym API unavailable – returning stale cache`);
        throw { code: "GYM_UNAVAILABLE" as const, staleStore: cached };
      }
      // No cache and gym is down – rethrow to surface a hard failure.
      throw err;
    }
    throw err;
  }

  // ── 4. Merge ─────────────────────────────────────────────────────────────
  const merged = mergeWeeklyStore(cached, incoming, nowDT, fetchedAt, detectedAt);

  const newDiffCount = merged.diffs.length - (cached?.diffs.length ?? 0);
  console.info(
    `${tag} merge complete: ${merged.slots.length} slots, ${newDiffCount} new diff(s)`,
  );

  // ── 5. Persist ───────────────────────────────────────────────────────────
  await saveWeeklyStore(key, merged);
  console.info(`${tag} persisted to Redis key="${key}"`);

  return merged;
}

// ---------------------------------------------------------------------------
// Read-through cache wrapper
// ---------------------------------------------------------------------------

/**
 * Cache cooldown window. If the store was last fetched less than this many
 * minutes ago and `forceRefresh` is false, the cached store is returned
 * directly without hitting the gym API.
 */
export const CACHE_COOLDOWN_MINUTES = 30;

/** Discriminated result returned by {@link getOrSyncWeeklySchedule}. */
export type SyncResult =
  | {
      /** Cache was fresh — gym API was NOT called. */
      fromCache: true;
      isStaleFallback: false;
      store: WeeklyScheduleStore;
    }
  | {
      /** Cache was stale / missing — gym API was called and Redis was updated. */
      fromCache: false;
      isStaleFallback: false;
      store: WeeklyScheduleStore;
    }
  | {
      /**
       * Gym API was unreachable during a required sync, but a stale store was
       * available in Redis and is returned as a best-effort response.
       */
      fromCache: false;
      isStaleFallback: true;
      store: WeeklyScheduleStore;
    };

/**
 * Read-through cache wrapper around {@link fetchAndSync}.
 *
 * Decision logic:
 * 1. Load the current week's store from Redis.
 * 2. If the store exists, `forceRefresh` is false, and `lastFetchedAt` is
 *    within {@link CACHE_COOLDOWN_MINUTES} minutes → return `{ fromCache: true }`.
 * 3. Otherwise call `fetchAndSync(userId)`.
 *    - On success → return `{ fromCache: false, isStaleFallback: false }`.
 *    - On `GYM_UNAVAILABLE` with a stale store → return `{ isStaleFallback: true }`
 *      instead of propagating an error, so the route can serve the stale data
 *      with an appropriate header.
 *
 * @throws {{ code: "GYM_TOKEN_EXPIRED" }} – always propagated to the caller.
 * @throws {GymUnavailableError}            – only when there is no cached store
 *                                            to fall back to.
 */
export async function getOrSyncWeeklySchedule(
  userId: string,
  options?: { forceRefresh?: boolean },
): Promise<SyncResult> {
  const forceRefresh = options?.forceRefresh ?? false;
  const tag = `[schedule-service:cache] userId=${userId}`;

  // ── Check existing cache ─────────────────────────────────────────────────
  const key = scheduleWeekKey(weekKey(new Date()));
  const cached = await getWeeklyStore(key);

  if (cached !== null && !forceRefresh) {
    const ageMs = Date.now() - new Date(cached.lastFetchedAt).getTime();
    const cooldownMs = CACHE_COOLDOWN_MINUTES * 60 * 1_000;

    if (ageMs < cooldownMs) {
      const ageMins = Math.floor(ageMs / 60_000);
      console.info(
        `${tag} cache HIT – age=${ageMins}m < cooldown=${CACHE_COOLDOWN_MINUTES}m`,
      );
      return { fromCache: true, isStaleFallback: false, store: cached };
    }

    console.info(
      `${tag} cache STALE – age=${Math.floor(ageMs / 60_000)}m ≥ cooldown=${CACHE_COOLDOWN_MINUTES}m, syncing`,
    );
  } else if (forceRefresh) {
    console.info(`${tag} forceRefresh=true – bypassing cache`);
  } else {
    console.info(`${tag} cache MISS – no store found for key="${key}", syncing`);
  }

  // ── Sync from gym API ─────────────────────────────────────────────────────
  try {
    const store = await fetchAndSync(userId);
    return { fromCache: false, isStaleFallback: false, store };
  } catch (err) {
    // Absorb GYM_UNAVAILABLE when a stale store is available so the route can
    // return best-effort data instead of a hard 502.
    if (isGymUnavailableError(err)) {
      console.warn(`${tag} gym unavailable, using stale cache as fallback`);
      return { fromCache: false, isStaleFallback: true, store: err.staleStore };
    }
    // GYM_TOKEN_EXPIRED and hard GymUnavailableError (no cache) propagate.
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal type guard
// ---------------------------------------------------------------------------

function isGymUnavailableError(
  err: unknown,
): err is { code: "GYM_UNAVAILABLE"; staleStore: WeeklyScheduleStore } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === "GYM_UNAVAILABLE" &&
    "staleStore" in err
  );
}

