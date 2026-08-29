/**
 * @file src/app/api/schedule/sync/route.ts
 * @spec SPEC-003 §4 – Schedule Ingestion & Dynamic Diffing
 *
 * GET /api/schedule/sync[?forceRefresh=true]
 *
 * Auth-guarded endpoint that returns the current week's schedule via a
 * read-through cache. The gym API is only called when the cached store is
 * absent, older than CACHE_COOLDOWN_MINUTES, or forceRefresh=true.
 *
 * Response shape (200):
 *   {
 *     slots:         NormalizedGymSlot[]
 *     diffs:         ScheduleDiff[]
 *     lastFetchedAt: string  (ISO 8601 IST)
 *   }
 *
 * Cache-status header on every 200:
 *   X-Cache-Status: HIT            – served from Redis, gym API not called
 *                   MISS_SYNCED    – cache was absent/stale; gym API called; Redis updated
 *                   STALE_FALLBACK – gym API unreachable; last-known store returned
 *
 * Error responses:
 *   401 { error: "UNAUTHENTICATED" }       – missing / invalid session cookie
 *   401 { error: "GYM_TOKEN_EXPIRED" }     – gym token absent or expired in Redis
 *   502 { error: "GYM_SERVICE_UNAVAILABLE" } – gym down AND no cached store to fall back to
 *   500 { error: "INTERNAL_ERROR" }
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  getOrSyncWeeklySchedule,
  type SyncResult,
} from "@/lib/schedule-service";
import { GymUnavailableError } from "@/lib/gym-client";
import { type WeeklyScheduleStore } from "@/types/gym";

// ---------------------------------------------------------------------------
// Cache-status header values
// ---------------------------------------------------------------------------

type CacheStatus = "HIT" | "MISS_SYNCED" | "STALE_FALLBACK";

function cacheStatusFromResult(result: SyncResult): CacheStatus {
  if (result.fromCache) return "HIT";
  if (result.isStaleFallback) return "STALE_FALLBACK";
  return "MISS_SYNCED";
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── 1. Authenticate ───────────────────────────────────────────────────────
  const session = await getSessionFromRequest(request);
  if (!session) {
    console.warn("[schedule/sync] request with missing/invalid session cookie");
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { userId } = session;
  const tag = `[schedule/sync] userId=${userId}`;

  // ── 2. Parse query params ─────────────────────────────────────────────────
  const forceRefresh =
    request.nextUrl.searchParams.get("forceRefresh") === "true";

  console.info(`${tag} GET /api/schedule/sync forceRefresh=${forceRefresh}`);

  // ── 3. Read-through cache ─────────────────────────────────────────────────
  try {
    const result = await getOrSyncWeeklySchedule(userId, { forceRefresh });
    const status = cacheStatusFromResult(result);

    console.info(
      `${tag} ${status} – ${result.store.slots.length} slots, ` +
        `${result.store.diffs.length} diffs`,
    );

    return scheduleResponse(result.store, status);
  } catch (err) {
    // ── GYM_TOKEN_EXPIRED ──────────────────────────────────────────────────
    if (isTokenExpiredError(err)) {
      console.warn(`${tag} gym token expired`);
      return NextResponse.json({ error: "GYM_TOKEN_EXPIRED" }, { status: 401 });
    }

    // ── Gym down with no fallback cache ───────────────────────────────────
    if (err instanceof GymUnavailableError) {
      console.error(`${tag} gym unavailable and no stale cache`, err.message);
      return NextResponse.json(
        { error: "GYM_SERVICE_UNAVAILABLE" },
        { status: 502 },
      );
    }

    // ── Unexpected ────────────────────────────────────────────────────────
    console.error(`${tag} unexpected error`, err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds the 200 response with the cache-status header set. */
function scheduleResponse(
  store: WeeklyScheduleStore,
  cacheStatus: CacheStatus,
): NextResponse {
  const res = NextResponse.json(
    {
      slots: store.slots,
      diffs: store.diffs,
      lastFetchedAt: store.lastFetchedAt,
    },
    { status: 200 },
  );
  res.headers.set("X-Cache-Status", cacheStatus);
  return res;
}

/** Type guard for the GYM_TOKEN_EXPIRED throw shape from getOrSyncWeeklySchedule. */
function isTokenExpiredError(err: unknown): err is { code: "GYM_TOKEN_EXPIRED" } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === "GYM_TOKEN_EXPIRED"
  );
}
