# SPEC-003: Schedule Ingestion & Dynamic Diffing

## 1. Context & Goal
- **Problem:** The Gym API only returns slots from current timestamp to Sunday end-of-week in IST, omitting past days. Mid-week schedule cancellations and room/time shifts occur without push notifications.
- **Goal:** Ingest schedule data, maintain a full 7-day Monday–Sunday week in a single Redis key, and detect slot cancellations/shifts during periodic refreshes.

## 2. Invariants & Guardrails
- **Timezone & Format Invariant:** All timestamps, dates, and times MUST strictly follow `Asia/Kolkata` (IST / UTC+5:30) and use 24-hour time format (`HH:mm`, e.g., `07:00`, `18:30`).
- **Full Week Retention Invariant:** The weekly schedule stored in Redis MUST retain data for the entire 7 days (Monday through Sunday) until Sunday 23:59:59 IST. Mid-week refreshes must never wipe past days.
- **Single Storage Key:** All schedule slots, diff alerts, and fetch metadata MUST be stored under a single Redis key: `schedule:week:{year}_W{weekNumber}` with a 7-day TTL.

## 3. Storage & Schema Contracts (Redis)

### Redis Contract
- **Key:** `schedule:week:{year}_W{weekNumber}` (e.g., `schedule:week:2026_W35`)
- **TTL:** `604800` (7 days)
- **Schema (`WeeklyScheduleStore`):**
  - `lastFetchedAt: string` (ISO 8601 IST)
  - `slots: NormalizedGymSlot[]`
  - `diffs: ScheduleDiff[]`

### Normalized Gym Slot (`NormalizedGymSlot`)
- `id: string`
- `date: string` (YYYY-MM-DD IST)
- `startTime: string` (HH:mm 24-hr IST)
- `endTime: string` (HH:mm 24-hr IST)
- `title: string` (e.g., "Kickboxing / S&C", "BJJ")
- `trainer: string`

### Diff Object Schema (`ScheduleDiff`)
- `type`: `'CANCELLED' | 'RESCHEDULED' | 'NEW'`
- `slotId`: `string`
- `title`: `string`
- `date: string` (YYYY-MM-DD IST)
- `originalTime`: `string` (HH:mm 24-hr IST)
- `updatedTime`: `string | null`
- `detectedAt`: `string` (ISO 8601 IST)

## 4. Execution Flow
1. **Fetch from Gym API:** Retrieve raw payload using stored gym Bearer token and normalize via `normalizeSchedulePayload()`. Ensure all times are mapped to 24-hour IST format.
2. **Load Existing Cache:** Read `schedule:week:{year}_W{weekNumber}` from Redis.
3. **Compute Diff & Merge:**
   - **If cache does not exist:** Store all fetched slots directly with `diffs: []`.
   - **If cache exists:** Compare incoming slots against existing future slots. Any previously cached future slot missing in the fresh payload is appended to `diffs` as `CANCELLED`. Update existing future slots with new data and preserve all past days.
4. **Save:** Write the merged `{ lastFetchedAt, slots, diffs }` back to the single Redis key with a 7-day TTL.

## 5. Error Handling
- **401 Unauthorized:** Return `401 { error: "GYM_TOKEN_EXPIRED" }`.
- **Gym API Failure (5xx / Timeout):** If cached data exists in Redis, return it with a warning header rather than failing.

## 6. Acceptance Criteria
- [ ] Times are strictly stored and output in 24-hour IST format (`HH:mm`).
- [ ] Mid-week sync on Thursday preserves Monday–Wednesday slots in the Redis cache.
- [ ] Diffing accurately identifies cancellations for future slots in the current week.
- [ ] Single key contains the complete weekly state.