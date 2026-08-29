/**
 * @file src/lib/__tests__/schedule-service.test.ts
 * @spec SPEC-003 §6 Acceptance Criteria
 *
 * Unit tests for the pure diffing and merge logic in schedule-service.ts.
 * These tests exercise computeDiffs and mergeWeeklyStore in isolation —
 * no Redis, no gym API, no Next.js runtime required.
 *
 * Both functions now accept a `nowDateTime` string (`YYYY-MM-DDTHH:MM` IST)
 * instead of a plain date string, matching the gym API's behaviour of only
 * returning slots from the current timestamp onwards.
 */

import { describe, it, expect } from "vitest";
import {
  computeDiffs,
  mergeWeeklyStore,
  weekKey,
  CACHE_COOLDOWN_MINUTES,
} from "@/lib/schedule-service";
import type { NormalizedGymSlot, WeeklyScheduleStore } from "@/types/gym";


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DETECTED_AT = "2026-08-29T10:00:00.000+05:30";
const FETCHED_AT  = "2026-08-29T10:00:00.000+05:30";

/**
 * "Now" used in the mid-day cutoff tests: 2026-08-29 at 18:30 IST.
 * Any slot on 2026-08-29 with startTime <= "18:30" is treated as past.
 */
const NOW_EVENING = "2026-08-29T18:30";

/**
 * "Now" used in tests that want all today-and-future slots to be treated as
 * future (i.e. sync happens very early in the day).
 */
const NOW_EARLY = "2026-08-29T06:00";

/** Builds a minimal NormalizedGymSlot. */
function slot(
  id: string,
  date: string,
  startTime = "07:00",
  endTime = "08:00",
  title = "BJJ",
  trainer = "Coach A",
): NormalizedGymSlot {
  return { id, date, startTime, endTime, title, trainer };
}

/** Builds a minimal WeeklyScheduleStore. */
function store(
  slots: NormalizedGymSlot[],
  diffs: WeeklyScheduleStore["diffs"] = [],
): WeeklyScheduleStore {
  return { lastFetchedAt: FETCHED_AT, slots, diffs };
}

// ---------------------------------------------------------------------------
// computeDiffs
// ---------------------------------------------------------------------------

describe("computeDiffs", () => {
  it("returns no diffs when cache and incoming are identical", () => {
    const slots = [slot("s1", "2026-09-01"), slot("s2", "2026-09-02")];
    const diffs = computeDiffs(slots, slots, NOW_EARLY, DETECTED_AT);
    expect(diffs).toHaveLength(0);
  });

  it("detects CANCELLED when a future cached slot is absent from incoming", () => {
    const cached = [
      slot("s1", "2026-09-01", "07:00"),
      slot("s2", "2026-09-02", "09:00"),
    ];
    const incoming = [slot("s1", "2026-09-01", "07:00")]; // s2 gone

    const diffs = computeDiffs(cached, incoming, NOW_EARLY, DETECTED_AT);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      type: "CANCELLED",
      slotId: "s2",
      date: "2026-09-02",
      originalTime: "09:00",
      updatedTime: null,
      detectedAt: DETECTED_AT,
    });
  });

  it("detects RESCHEDULED when startTime changes for a future slot", () => {
    const cached = [slot("s1", "2026-09-01", "07:00")];
    const incoming = [slot("s1", "2026-09-01", "08:30")]; // time shifted

    const diffs = computeDiffs(cached, incoming, NOW_EARLY, DETECTED_AT);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      type: "RESCHEDULED",
      slotId: "s1",
      date: "2026-09-01",
      originalTime: "07:00",
      updatedTime: "08:30",
      detectedAt: DETECTED_AT,
    });
  });

  it("detects NEW when a future slot appears in incoming but not in cache", () => {
    const cached = [slot("s1", "2026-09-01", "07:00")];
    const incoming = [
      slot("s1", "2026-09-01", "07:00"),
      slot("s2", "2026-09-03", "18:00"), // brand new slot
    ];

    const diffs = computeDiffs(cached, incoming, NOW_EARLY, DETECTED_AT);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      type: "NEW",
      slotId: "s2",
      date: "2026-09-03",
      originalTime: "18:00",
      updatedTime: null,
      detectedAt: DETECTED_AT,
    });
  });

  it("does NOT generate CANCELLED for a past-day slot missing from incoming", () => {
    const cached = [
      slot("past-1", "2026-08-25", "07:00"), // previous day
      slot("future-1", "2026-09-01", "07:00"),
    ];
    const incoming = [slot("future-1", "2026-09-01", "07:00")];

    const diffs = computeDiffs(cached, incoming, NOW_EARLY, DETECTED_AT);

    expect(diffs.find((d) => d.slotId === "past-1")).toBeUndefined();
    expect(diffs).toHaveLength(0);
  });

  it("does NOT generate CANCELLED for a same-day already-started slot (gym API cutoff scenario)", () => {
    // Scenario: it is 18:30 IST. The 07:00 Kickboxing session already happened.
    // The gym API won't return it. This should NOT produce a CANCELLED diff.
    const cached = [
      slot("kb-morning", "2026-08-29", "07:00"), // started at 07:00, now 18:30 → past
      slot("bjj-evening", "2026-08-29", "19:00"), // 19:00 → still future
    ];
    const incoming = [
      // gym API only returned the 19:00 session
      slot("bjj-evening", "2026-08-29", "19:00"),
    ];

    const diffs = computeDiffs(cached, incoming, NOW_EVENING, DETECTED_AT);

    // kb-morning absent from incoming because gym API cut it off, NOT cancelled
    expect(diffs.find((d) => d.slotId === "kb-morning")).toBeUndefined();
    expect(diffs).toHaveLength(0);
  });

  it("still detects CANCELLED for a same-day slot that starts in the future but was removed", () => {
    // 19:00 class exists in cache but has been genuinely cancelled
    const cached = [
      slot("kb-morning", "2026-08-29", "07:00"), // past (18:30 now)
      slot("bjj-evening", "2026-08-29", "19:00"), // future — should be diffed
    ];
    const incoming: NormalizedGymSlot[] = [
      // bjj-evening is genuinely cancelled — not just cut off by API
    ];

    const diffs = computeDiffs(cached, incoming, NOW_EVENING, DETECTED_AT);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      type: "CANCELLED",
      slotId: "bjj-evening",
      originalTime: "19:00",
    });
  });

  it("does NOT generate NEW for a past-day slot only in incoming", () => {
    const cached: NormalizedGymSlot[] = [];
    const incoming = [slot("past-only", "2026-08-25", "07:00")];

    const diffs = computeDiffs(cached, incoming, NOW_EARLY, DETECTED_AT);

    expect(diffs).toHaveLength(0);
  });

  it("handles multiple diffs of different types in one call", () => {
    const cached = [
      slot("keep",  "2026-09-01", "07:00"), // unchanged
      slot("gone",  "2026-09-02", "09:00"), // will be cancelled
      slot("shift", "2026-09-03", "17:00"), // will be rescheduled
    ];
    const incoming = [
      slot("keep",  "2026-09-01", "07:00"), // unchanged
      slot("shift", "2026-09-03", "18:00"), // rescheduled
      slot("new1",  "2026-09-04", "06:00"), // new
    ];

    const diffs = computeDiffs(cached, incoming, NOW_EARLY, DETECTED_AT);

    const types = diffs.map((d) => d.type).sort();
    expect(types).toEqual(["CANCELLED", "NEW", "RESCHEDULED"]);
  });
});

// ---------------------------------------------------------------------------
// mergeWeeklyStore
// ---------------------------------------------------------------------------

describe("mergeWeeklyStore", () => {
  it("stores all incoming slots with empty diffs on first sync (cached = null)", () => {
    const incoming = [slot("s1", "2026-09-01"), slot("s2", "2026-09-02")];
    const merged = mergeWeeklyStore(null, incoming, NOW_EARLY, FETCHED_AT, DETECTED_AT);

    expect(merged.slots).toHaveLength(2);
    expect(merged.diffs).toHaveLength(0);
    expect(merged.lastFetchedAt).toBe(FETCHED_AT);
  });

  it("preserves past-day slots from cache and replaces future slots from incoming", () => {
    const mondaySlot   = slot("mon", "2026-08-24", "07:00"); // past day
    const tuesdaySlot  = slot("tue", "2026-08-25", "08:00"); // past day
    const futureSlot   = slot("fut", "2026-09-01", "09:00"); // future day

    const cached = store([mondaySlot, tuesdaySlot, futureSlot]);
    const newFutureSlot = slot("fut-new", "2026-09-05", "10:00");
    const incoming = [newFutureSlot];

    const merged = mergeWeeklyStore(cached, incoming, NOW_EARLY, FETCHED_AT, DETECTED_AT);

    const ids = merged.slots.map((s) => s.id).sort();
    expect(ids).toContain("mon");
    expect(ids).toContain("tue");
    expect(ids).toContain("fut-new");
    expect(ids).not.toContain("fut"); // old future slot replaced
  });

  it("preserves already-started same-day slots that the gym API no longer returns", () => {
    // Scenario: sync at 18:30. The 07:00 KB is over. The gym API doesn't
    // return it, but the merged store must still contain it.
    const morningKB  = slot("kb",  "2026-08-29", "07:00"); // past (it's 18:30)
    const eveningBJJ = slot("bjj", "2026-08-29", "19:00"); // future

    const cached = store([morningKB, eveningBJJ]);

    // Gym API only returns the 19:00 session; 07:00 is cut off.
    const incoming = [slot("bjj", "2026-08-29", "19:00")];

    const merged = mergeWeeklyStore(cached, incoming, NOW_EVENING, FETCHED_AT, DETECTED_AT);

    const ids = merged.slots.map((s) => s.id);
    expect(ids).toContain("kb");  // preserved from cache
    expect(ids).toContain("bjj"); // taken from incoming
    expect(merged.diffs).toHaveLength(0); // no false CANCELLED
  });

  it("appends new diffs to existing diff log on subsequent syncs", () => {
    const existingDiff: WeeklyScheduleStore["diffs"][number] = {
      type: "CANCELLED",
      slotId: "old-s",
      title: "Kickboxing",
      date: "2026-08-26",
      originalTime: "07:00",
      updatedTime: null,
      detectedAt: "2026-08-26T08:00:00.000+05:30",
    };
    const cached = store([slot("s1", "2026-09-01", "07:00")], [existingDiff]);

    // Incoming has a time shift for s1
    const incoming = [slot("s1", "2026-09-01", "08:00")];
    const merged = mergeWeeklyStore(cached, incoming, NOW_EARLY, FETCHED_AT, DETECTED_AT);

    expect(merged.diffs).toHaveLength(2);
    expect(merged.diffs[0]).toBe(existingDiff); // original preserved
    expect(merged.diffs[1]?.type).toBe("RESCHEDULED");
  });

  it("updates lastFetchedAt on every merge", () => {
    const newFetchedAt = "2026-08-29T15:30:00.000+05:30";
    const cached = store([slot("s1", "2026-09-01")]);
    const merged = mergeWeeklyStore(
      cached,
      [slot("s1", "2026-09-01")],
      NOW_EARLY,
      newFetchedAt,
      DETECTED_AT,
    );

    expect(merged.lastFetchedAt).toBe(newFetchedAt);
  });
});

// ---------------------------------------------------------------------------
// weekKey
// ---------------------------------------------------------------------------

describe("weekKey", () => {
  it("returns a string matching the YYYY_Www pattern", () => {
    const key = weekKey(new Date("2026-08-29T06:30:00Z")); // IST = 2026-08-29 12:00
    expect(key).toMatch(/^\d{4}_W\d{2}$/);
  });

  it("returns W35 for a date in week 35 of 2026", () => {
    // 2026-08-24 is Monday of W35; 2026-08-29 (Sat) is still W35.
    const key = weekKey(new Date("2026-08-29T06:30:00Z"));
    expect(key).toBe("2026_W35");
  });

  it("returns W01 for the first ISO week of a year", () => {
    // 2024-01-01 (Mon) is in ISO W01 2024.
    const key = weekKey(new Date("2023-12-31T20:00:00Z")); // IST = 2024-01-01 01:30
    expect(key).toBe("2024_W01");
  });
});

// ---------------------------------------------------------------------------
// CACHE_COOLDOWN_MINUTES — pure arithmetic
// ---------------------------------------------------------------------------

describe("CACHE_COOLDOWN_MINUTES", () => {
  it("is exported as 30", () => {
    expect(CACHE_COOLDOWN_MINUTES).toBe(30);
  });

  it("cooldown window in ms is 1_800_000", () => {
    expect(CACHE_COOLDOWN_MINUTES * 60 * 1_000).toBe(1_800_000);
  });

  it("a store fetched 10 min ago is within the cooldown window", () => {
    const ageMs = 10 * 60 * 1_000; // 10 minutes
    const cooldownMs = CACHE_COOLDOWN_MINUTES * 60 * 1_000;
    expect(ageMs).toBeLessThan(cooldownMs);
  });

  it("a store fetched 31 min ago is outside the cooldown window", () => {
    const ageMs = 31 * 60 * 1_000; // 31 minutes
    const cooldownMs = CACHE_COOLDOWN_MINUTES * 60 * 1_000;
    expect(ageMs).toBeGreaterThanOrEqual(cooldownMs);
  });
});

