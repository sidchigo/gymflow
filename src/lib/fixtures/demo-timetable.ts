/**
 * @file src/lib/fixtures/demo-timetable.ts
 * @description Synthetic timetable fixtures containing weekly BJJ, Kickboxing, and open gym slots.
 */

import { type NormalizedGymSlot } from "@/types/gym";
import demoTimetableJson from "../../../fixtures/demo-timetable.json";

export const STATIC_DEMO_TIMETABLE_SLOTS: NormalizedGymSlot[] = demoTimetableJson as NormalizedGymSlot[];

// Day of week index mapping for demo timetable templates
// Mon = 0, Tue = 1, Wed = 2, Thu = 3, Fri = 4, Sat = 5, Sun = 6
const SLOT_DAY_INDEXES: Record<string, number> = {
  slot_kb_mon: 0,
  slot_bjj_mon: 0,
  slot_open_mon: 0,
  slot_kb_tue: 1,
  slot_open_tue: 1,
  slot_bjj_wed: 2,
  slot_kb_wed: 2,
  slot_open_wed: 2,
  slot_box_thu: 3,
  slot_open_thu: 3,
  slot_bjj_fri: 4,
  slot_kb_fri: 4,
  slot_open_fri: 4,
  slot_kb_sat: 5,
  slot_bjj_sat: 5,
  slot_cond_sat: 5,
  slot_open_sat: 5,
  slot_mob_sun: 6,
  slot_open_sun: 6,
};

function getMondayOfIsoWeek(year: number, week: number): Date {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const isoWeekStart = simple;
  if (dow <= 4) {
    isoWeekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    isoWeekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  return isoWeekStart;
}

/**
 * Returns synthetic gym timetable slots for a requested ISO week (e.g., "2026_W35").
 * If no week is specified, defaults to "2026_W35".
 * Slots automatically align their ISO dates (YYYY-MM-DD) with the target week's Monday–Sunday dates.
 */
export function getDemoTimetableSlots(isoWeekId?: string): NormalizedGymSlot[] {
  if (!isoWeekId || isoWeekId === "2026_W35") {
    return JSON.parse(JSON.stringify(STATIC_DEMO_TIMETABLE_SLOTS));
  }

  // Parse YYYY_Www or YYYY-Www
  const parts = isoWeekId.replace("_", "-").split("-");
  const year = parseInt(parts[0] || "", 10);
  const week = parseInt((parts[1] || "").replace("W", ""), 10);

  if (isNaN(year) || isNaN(week)) {
    return JSON.parse(JSON.stringify(STATIC_DEMO_TIMETABLE_SLOTS));
  }

  const monday = getMondayOfIsoWeek(year, week);

  return STATIC_DEMO_TIMETABLE_SLOTS.map((slot) => {
    const dayIdx = SLOT_DAY_INDEXES[slot.id] ?? 0;
    const targetDate = new Date(monday);
    targetDate.setUTCDate(monday.getUTCDate() + dayIdx);
    const dateStr = targetDate.toISOString().split("T")[0]!;

    return {
      ...slot,
      date: dateStr,
    };
  });
}

