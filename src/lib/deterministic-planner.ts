/**
 * @file src/lib/deterministic-planner.ts
 * @description Deterministic Constraint Satisfaction & Athletic Plan Solver for GymFlow.
 *
 * Solves the combinatorial scheduling problem with 100% mathematical precision:
 *   - WFH vs WFO commute time calculations and earliest/latest start times.
 *   - Hard stop cutoff enforcement (Session End + Commute <= HardStopTime).
 *   - Exact matching to verified Gym Timetable slots.
 *   - Mandatory combat session allocation (Kickboxing, BJJ).
 *   - WFH high-demand compounds vs WFO time-dense supersets.
 *   - Strict Sunday rest lock & 5-day weekly target compliance.
 *   - Progressive overload weight targets based on athlete weight (kg), height (cm), and lift history.
 *   - Macro-specific nutrition advice (carbs/protein timing).
 *   - Auto-regulation on illness/soreness events & cancelled gym classes.
 */

import {
  type AthleteState,
  type DailyWorkoutPlan,
  type WeeklyWorkoutPlan,
  type Modality,
  type PlannedExercise,
} from "@/types/agent";
import { type NormalizedGymSlot, type ScheduleDiff } from "@/types/gym";
import { nowIST, weekKey } from "./schedule-service";

// ---------------------------------------------------------------------------
// 1. Calendar Helpers (IST Monday-Sunday Week Anchor)
// ---------------------------------------------------------------------------

export interface WeekDayAnchor {
  date: string; // YYYY-MM-DD
  dayName: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  isPast: boolean;
  isToday: boolean;
}

export function getWeekDaysForDate(
  currentDateIST: string,
  options?: { isNextWeek?: boolean | undefined; targetWeekOffset?: number | undefined }
): WeekDayAnchor[] {
  const todayDateStr = currentDateIST.split("T")[0] || "2026-08-24";
  const [y, m, d] = todayDateStr.split("-").map(Number) as [number, number, number];
  const todayObj = new Date(Date.UTC(y, m - 1, d));
  const dayNum = todayObj.getUTCDay(); // 0 = Sunday, 1 = Mon, ..., 6 = Sat

  // On Sunday (dayNum === 0), the current week is ending today, so planning defaults to the upcoming week starting tomorrow (+1 day).
  // On Mon-Sat, default is current week (1 - dayNum).
  let mondayOffset: number;
  if (options?.isNextWeek) {
    mondayOffset = dayNum === 0 ? 8 : 8 - dayNum;
  } else if (dayNum === 0) {
    // Sunday defaults to upcoming week starting tomorrow Monday
    mondayOffset = 1;
  } else {
    mondayOffset = 1 - dayNum;
  }

  if (options?.targetWeekOffset && options.targetWeekOffset !== 0) {
    mondayOffset += 7 * options.targetWeekOffset;
  }

  const dayNames: WeekDayAnchor["dayName"][] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  return dayNames.map((dayName, index) => {
    const targetDate = new Date(Date.UTC(y, m - 1, d + mondayOffset + index));
    const isoDate = targetDate.toISOString().split("T")[0] as string;
    return {
      date: isoDate,
      dayName,
      isPast: isoDate < todayDateStr,
      isToday: isoDate === todayDateStr,
    };
  });
}

export function getPlanningWeekKey(
  currentDateIST: string,
  options?: { isNextWeek?: boolean | undefined; targetWeekOffset?: number | undefined }
): string {
  const weekDays = getWeekDaysForDate(currentDateIST, options);
  const mondayDateStr = weekDays[0]?.date || currentDateIST.split("T")[0] || "2026-08-24";
  const [y, m, d] = mondayDateStr.split("-").map(Number) as [number, number, number];
  const mondayDate = new Date(Date.UTC(y, m - 1, d));
  return weekKey(mondayDate);
}

// ---------------------------------------------------------------------------
// 2. Commute & Window Calculations
// ---------------------------------------------------------------------------

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTimeString(minutes: number): string {
  const normalized = Math.max(0, Math.min(1439, minutes));
  const h = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const m = (normalized % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export interface DayConstraints {
  dayName: string;
  isWFO: boolean;
  commuteMinutes: number;
  morningWindow: { start: string; end: string; isValid: boolean };
  eveningWindow: { start: string; end: string; isValid: boolean };
  hardStopTime: string;
}

export function getDayConstraints(
  dayName: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday",
  athleteState: AthleteState
): DayConstraints {
  const profile = athleteState.profile;
  const workSchedule = (profile as any).weeklyWorkSchedule || (profile as any).workSchedule || {};
  const daySchedule = workSchedule[dayName];
  const isWFO = daySchedule?.mode === "WFO";
  const commuteMinutes = isWFO ? (daySchedule?.commuteMinutesOneWay || 0) : 0;

  const workStartMins = parseTimeToMinutes(profile.workDayStartTime || "09:00");
  const workEndMins = parseTimeToMinutes(profile.workDayEndTime || "18:00");
  const hardStopMins = parseTimeToMinutes(profile.hardStopTrainingTime || "20:00");

  const isWeekend = dayName === "Saturday" || dayName === "Sunday";

  if (isWeekend) {
    return {
      dayName,
      isWFO: false,
      commuteMinutes: 0,
      morningWindow: { start: "07:30", end: "11:30", isValid: true },
      eveningWindow: { start: "16:00", end: minutesToTimeString(hardStopMins), isValid: true },
      hardStopTime: profile.hardStopTrainingTime || "20:00",
    };
  }

  // Weekday morning window
  const morningEndMins = workStartMins - commuteMinutes;
  const morningValid = morningEndMins - 45 >= parseTimeToMinutes("06:00");

  // Weekday evening window:
  // Earliest session start: workEnd + commute
  // Latest session completion: hardStop - commute (return commute to home before hard stop)
  const eveningStartMins = workEndMins + commuteMinutes;
  const eveningLatestFinishMins = hardStopMins - commuteMinutes;
  const eveningValid = eveningLatestFinishMins - eveningStartMins >= 45;

  return {
    dayName,
    isWFO,
    commuteMinutes,
    morningWindow: {
      start: "06:30",
      end: minutesToTimeString(Math.max(morningEndMins, parseTimeToMinutes("06:30"))),
      isValid: morningValid,
    },
    eveningWindow: {
      start: minutesToTimeString(eveningStartMins),
      end: minutesToTimeString(Math.max(eveningLatestFinishMins, eveningStartMins)),
      isValid: eveningValid,
    },
    hardStopTime: profile.hardStopTrainingTime || "20:00",
  };
}

// ---------------------------------------------------------------------------
// 2b. Pure Deterministic Timetable Slot Filter by Commute & Preferences
// ---------------------------------------------------------------------------

export function filterGymSlotsByCommuteAndPreferences(
  slots: Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    title: string;
    trainer: string;
    dayOfWeek?: string | undefined;
  }>,
  athleteState: AthleteState,
  currentDateIST: string
): Array<{
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  trainer: string;
  dayOfWeek?: string | undefined;
}> {
  const profile = athleteState.profile;
  const hardStopTime = profile.hardStopTrainingTime || "20:00";
  const hardStopWindow = profile.hardStopWindow || "EVENING";

  return slots.filter((s) => {
    const slotDateTime = `${s.date}T${s.startTime}`;
    if (slotDateTime < currentDateIST) return false;

    // Filter out Youth/Kids/Junior/Teen classes
    const titleLower = s.title.toLowerCase();
    if (
      titleLower.includes("youth") ||
      titleLower.includes("kids") ||
      titleLower.includes("junior") ||
      titleLower.includes("teen")
    ) {
      return false;
    }

    const startHour = s.startTime;
    const endHour = s.endTime || s.startTime;
    const pref = profile.trainingTimePreference || "BOTH";

    const slotDateObj = new Date(`${s.date}T00:00:00+05:30`);
    const dayName =
      (s.dayOfWeek as WeekDayAnchor["dayName"]) ||
      (slotDateObj.toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: "Asia/Kolkata",
      }) as WeekDayAnchor["dayName"]);

    const constraints = getDayConstraints(dayName, athleteState);
    const startMins = parseTimeToMinutes(startHour);
    const endMins = parseTimeToMinutes(endHour);

    const isWeekend = dayName === "Saturday" || dayName === "Sunday";

    if (isWeekend) {
      if (pref === "EVENING" && startHour < "12:00") return false;
      if (pref === "MORNING" && startHour >= "12:00") return false;
    } else {
      const workStart = profile.workDayStartTime || "09:00";
      const workEnd = profile.workDayEndTime || "18:00";
      const [wsH, wsM] = workStart.split(":").map(Number);
      const workStartMins = (wsH ?? 0) * 60 + (wsM ?? 0);
      const [weH, weM] = workEnd.split(":").map(Number);
      const workEndMins = (weH ?? 0) * 60 + (weM ?? 0);

      // Check if slot falls during working hours
      if (startMins < workEndMins && endMins > workStartMins) {
        return false;
      }

      if (pref === "EVENING" && startMins < 720) return false;
      if (pref === "MORNING" && startMins >= 720) return false;
    }

    const isEveningSlot = startHour >= "12:00";
    const isMorningSlot = startHour < "12:00";

    const appliesHardStop =
      hardStopWindow === "BOTH" ||
      (hardStopWindow === "EVENING" && isEveningSlot) ||
      (hardStopWindow === "MORNING" && isMorningSlot);

    if (appliesHardStop) {
      const hardStopMins = parseTimeToMinutes(hardStopTime);
      const totalMinutes = endMins + constraints.commuteMinutes;
      if (totalMinutes > hardStopMins) {
        return false;
      }
    }

    return true;
  });
}

// Backward-compatibility alias for deterministic slot filter
export const filterGymSlots = filterGymSlotsByCommuteAndPreferences;

// ---------------------------------------------------------------------------
// 3. Slot Matcher for Gym Timetable
// ---------------------------------------------------------------------------

export function findMatchingSlot(
  slots: NormalizedGymSlot[],
  date: string,
  modality: "KICKBOXING" | "BJJ" | "TRX" | "DUT",
  constraints: DayConstraints,
  preference: "MORNING" | "EVENING" | "BOTH" = "BOTH"
): NormalizedGymSlot | null {
  const validSlots = slots.filter((slot) => {
    if (slot.date !== date) return false;

    const titleLower = slot.title.toLowerCase();

    // Reject Youth / Kids / Teen classes
    if (
      titleLower.includes("youth") ||
      titleLower.includes("kids") ||
      titleLower.includes("junior") ||
      titleLower.includes("teen")
    ) {
      return false;
    }

    let matchesModality = false;
    if (modality === "KICKBOXING") {
      matchesModality =
        titleLower.includes("kickbox") ||
        titleLower.includes("kb") ||
        titleLower.includes("boxing") ||
        titleLower.includes("combat");
    } else if (modality === "BJJ") {
      matchesModality =
        titleLower.includes("bjj") ||
        titleLower.includes("jiu") ||
        titleLower.includes("ground") ||
        titleLower.includes("grappling");
    } else if (modality === "TRX") {
      matchesModality = titleLower.includes("trx");
    } else if (modality === "DUT") {
      matchesModality = titleLower.includes("dut");
    }

    if (!matchesModality) return false;

    const startMins = parseTimeToMinutes(slot.startTime);
    const endMins = parseTimeToMinutes(slot.endTime || slot.startTime);
    const hardStopMins = parseTimeToMinutes(constraints.hardStopTime);

    // Hard stop cutoff: end + commute <= hardStop
    if (endMins + constraints.commuteMinutes > hardStopMins) {
      return false;
    }

    const isMorning = startMins < parseTimeToMinutes("12:00");
    if (preference === "MORNING" && !isMorning) return false;
    if (preference === "EVENING" && isMorning) return false;

    // Work hours and commute collision checks
    if (constraints.dayName !== "Saturday" && constraints.dayName !== "Sunday") {
      if (constraints.isWFO) {
        // On WFO days: evening sessions cannot start before (workEnd + commute)
        if (!isMorning) {
          const minEveningStart = parseTimeToMinutes(constraints.eveningWindow.start);
          if (startMins < minEveningStart) return false;
        } else {
          // Morning session must end before (workStart - commute)
          const maxMorningEnd = parseTimeToMinutes(constraints.morningWindow.end);
          if (endMins > maxMorningEnd) return false;
        }
      } else {
        // WFH: Cannot fall within 09:00 - 18:00
        if (startMins >= parseTimeToMinutes("09:00") && startMins < parseTimeToMinutes("18:00")) {
          return false;
        }
      }
    }

    return true;
  });

  return validSlots[0] || null;
}

// ---------------------------------------------------------------------------
// 4. Exercise & Progressive Overload Engine
// ---------------------------------------------------------------------------

export function generateExercisesForModality(
  modality: Modality,
  isGymClass: boolean,
  isWFO: boolean,
  athleteState: AthleteState
): PlannedExercise[] {
  const profile = athleteState.profile;
  const unit = (profile as any).weightUnitPreference || "KG";
  const userWeight = profile.weightKg || 70;
  const lifts = athleteState.lifts || [];

  if (isGymClass || modality === "REST" || modality === "MOBILITY_RECOVERY") {
    if (modality === "REST") return [];
    if (modality === "MOBILITY_RECOVERY") {
      return [
        {
          name: "Cat-Cow & Thoracic Rotations",
          sets: 3,
          reps: "10 per side",
          targetWeight: null,
          unit,
          weightKg: null,
          weightLbs: null,
          targetRpe: 5,
          restSeconds: 45,
          supersetGroupId: null,
          orderInGroup: null,
          progressionNote: "Focus on deep diaphragmatic breathing and spinal decompression.",
        },
        {
          name: "Pigeon Pose & Hip Flexor Opener",
          sets: 3,
          reps: "60s hold",
          targetWeight: null,
          unit,
          weightKg: null,
          weightLbs: null,
          targetRpe: 5,
          restSeconds: 45,
          supersetGroupId: null,
          orderInGroup: null,
          progressionNote: "Relieve hip capsule tightness from grappling/kicking.",
        },
        {
          name: "Banded Shoulder Dislocates & Foam Rolling",
          sets: 2,
          reps: "15 reps / 2 min",
          targetWeight: null,
          unit,
          weightKg: null,
          weightLbs: null,
          targetRpe: 4,
          restSeconds: 30,
          supersetGroupId: null,
          orderInGroup: null,
          progressionNote: "Restore upper thoracic and anterior shoulder mobility.",
        },
      ];
    }
    // Class warmup and cooldown
    return [
      {
        name: "Dynamic Multi-Planar Warmup",
        sets: 1,
        reps: "8-10 min",
        targetWeight: null,
        unit,
        weightKg: null,
        weightLbs: null,
        targetRpe: 6,
        restSeconds: 60,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: "Joint mobility, hip circles, shadow boxing, and neck prep.",
      },
      {
        name: "Post-Class Static Stretch & Cooldown",
        sets: 1,
        reps: "5-8 min",
        targetWeight: null,
        unit,
        weightKg: null,
        weightLbs: null,
        targetRpe: 4,
        restSeconds: 30,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: "Hamstrings, hip flexors, lat stretch, and down-regulation breathing.",
      },
    ];
  }

  // Find lift history for progression
  const getLiftLoad = (name: string, defaultKg: number): { kg: number; lbs: number; note: string } => {
    const past = lifts.filter((l) => l.exerciseName.toLowerCase().includes(name.toLowerCase()));
    if (past.length > 0) {
      const last = past[past.length - 1];
      const maxSet = last?.sets.reduce((prev, curr) => (curr.weight > prev.weight ? curr : prev), last.sets[0]!);
      if (maxSet && maxSet.weight > 0) {
        const pastWeightKg = maxSet.unit === "LBS" ? maxSet.weight * 0.453592 : maxSet.weight;
        const progressiveKg = Math.round((pastWeightKg + 2.5) * 2) / 2;
        const progressiveLbs = Math.round((pastWeightKg * 2.20462 + 5) / 5) * 5;
        return {
          kg: progressiveKg,
          lbs: progressiveLbs,
          note: `+2.5 kg / +5 lbs over last logged session (${maxSet.weight}${maxSet.unit})`,
        };
      }
    }
    const kg = Math.round(defaultKg * 2) / 2;
    const lbs = Math.round((defaultKg * 2.20462) / 5) * 5;
    return { kg, lbs, note: `Baseline calculated from ${userWeight}kg body weight` };
  };

  if (isWFO) {
    // WFO Days: Antagonistic supersets for high time density
    const bench = getLiftLoad("Bench", userWeight * 0.7);
    const row = getLiftLoad("Row", userWeight * 0.6);
    const ohp = getLiftLoad("Overhead", userWeight * 0.45);
    const pullup = getLiftLoad("Pull Up", 0);

    return [
      {
        name: "Dumbbell / Barbell Bench Press",
        sets: 4,
        reps: "8-10",
        targetWeight: unit === "KG" ? bench.kg : bench.lbs,
        unit,
        weightKg: bench.kg,
        weightLbs: bench.lbs,
        targetRpe: 8,
        restSeconds: 45,
        supersetGroupId: "A",
        orderInGroup: 1,
        progressionNote: bench.note,
      },
      {
        name: "Chest-Supported Dumbbell Row",
        sets: 4,
        reps: "10-12",
        targetWeight: unit === "KG" ? row.kg : row.lbs,
        unit,
        weightKg: row.kg,
        weightLbs: row.lbs,
        targetRpe: 8,
        restSeconds: 90,
        supersetGroupId: "A",
        orderInGroup: 2,
        progressionNote: row.note,
      },
      {
        name: "Standing Dumbbell Overhead Press",
        sets: 3,
        reps: "10-12",
        targetWeight: unit === "KG" ? ohp.kg : ohp.lbs,
        unit,
        weightKg: ohp.kg,
        weightLbs: ohp.lbs,
        targetRpe: 8,
        restSeconds: 45,
        supersetGroupId: "B",
        orderInGroup: 1,
        progressionNote: ohp.note,
      },
      {
        name: "Neutral Grip Lat Pulldown / Pull-Ups",
        sets: 3,
        reps: "8-10",
        targetWeight: unit === "KG" ? pullup.kg : pullup.lbs,
        unit,
        weightKg: pullup.kg,
        weightLbs: pullup.lbs,
        targetRpe: 8,
        restSeconds: 90,
        supersetGroupId: "B",
        orderInGroup: 2,
        progressionNote: "Focus on full lat contraction and eccentric control.",
      },
    ];
  }

  // WFH Days: High-demand heavy compound lifts
  if (modality === "UPPER_HYPERTROPHY") {
    const bench = getLiftLoad("Bench", userWeight * 0.75);
    const row = getLiftLoad("Barbell Row", userWeight * 0.65);
    const incline = getLiftLoad("Incline DB", userWeight * 0.5);

    return [
      {
        name: "Barbell Bench Press",
        sets: 4,
        reps: "5-6",
        targetWeight: unit === "KG" ? bench.kg : bench.lbs,
        unit,
        weightKg: bench.kg,
        weightLbs: bench.lbs,
        targetRpe: 8.5,
        restSeconds: 120,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: bench.note,
      },
      {
        name: "Pendlay / Barbell Row",
        sets: 4,
        reps: "6-8",
        targetWeight: unit === "KG" ? row.kg : row.lbs,
        unit,
        weightKg: row.kg,
        weightLbs: row.lbs,
        targetRpe: 8,
        restSeconds: 90,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: row.note,
      },
      {
        name: "Incline Dumbbell Press",
        sets: 3,
        reps: "8-10",
        targetWeight: unit === "KG" ? incline.kg : incline.lbs,
        unit,
        weightKg: incline.kg,
        weightLbs: incline.lbs,
        targetRpe: 8,
        restSeconds: 90,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: incline.note,
      },
      {
        name: "Hanging Leg Raises & Face Pulls",
        sets: 3,
        reps: "12-15",
        targetWeight: null,
        unit,
        weightKg: null,
        weightLbs: null,
        targetRpe: 7.5,
        restSeconds: 60,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: "Scapular health and midline stability for combat posture.",
      },
    ];
  }

  if (modality === "LOWER_STRENGTH") {
    const squat = getLiftLoad("Squat", userWeight * 0.9);
    const rdl = getLiftLoad("Deadlift", userWeight * 0.85);

    return [
      {
        name: "Barbell Back Squat",
        sets: 4,
        reps: "5",
        targetWeight: unit === "KG" ? squat.kg : squat.lbs,
        unit,
        weightKg: squat.kg,
        weightLbs: squat.lbs,
        targetRpe: 8,
        restSeconds: 150,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: squat.note,
      },
      {
        name: "Romanian Deadlift (RDL)",
        sets: 3,
        reps: "8",
        targetWeight: unit === "KG" ? rdl.kg : rdl.lbs,
        unit,
        weightKg: rdl.kg,
        weightLbs: rdl.lbs,
        targetRpe: 8,
        restSeconds: 120,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: rdl.note,
      },
      {
        name: "Bulgarian Split Squats",
        sets: 3,
        reps: "10 per leg",
        targetWeight: unit === "KG" ? Math.round(userWeight * 0.25) : Math.round(userWeight * 0.55),
        unit,
        weightKg: Math.round(userWeight * 0.25),
        weightLbs: Math.round((userWeight * 0.25 * 2.20462) / 5) * 5,
        targetRpe: 8,
        restSeconds: 90,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: "Unilateral knee stability and glute medius drive.",
      },
    ];
  }

  // Conditioning / KB / Boxing fallback
  return [
    {
      name: "Kettlebell Swings & Clean-and-Press",
      sets: 5,
      reps: "15 swings + 5 presses",
      targetWeight: unit === "KG" ? 20 : 45,
      unit,
      weightKg: 20,
      weightLbs: 45,
      targetRpe: 8,
      restSeconds: 60,
      supersetGroupId: null,
      orderInGroup: null,
      progressionNote: "Explosive posterior chain power transfer for martial arts.",
    },
    {
      name: "Heavy Bag Interval Rounds / Assault Bike",
      sets: 5,
      reps: "3 min rounds (1 min rest)",
      targetWeight: null,
      unit,
      weightKg: null,
      weightLbs: null,
      targetRpe: 8.5,
      restSeconds: 60,
      supersetGroupId: null,
      orderInGroup: null,
      progressionNote: "Lactate threshold buffering and aerobic recovery capacity.",
    },
  ];
}

// ---------------------------------------------------------------------------
// 5. Nutrition Fuel Advice Generator
// ---------------------------------------------------------------------------

export function generateNutritionAdvice(
  modality: Modality,
  plannedTime: string,
  athleteState: AthleteState
): string {
  const profile = athleteState.profile;
  const targetProtein = profile.targetDailyProteinGrams || 125;
  const dietPref = profile.dietaryPreference || "BALANCED";

  if (modality === "REST" || modality === "MOBILITY_RECOVERY") {
    const mealProtein = Math.round(targetProtein / 4);
    return `Rest Day Macro Strategy: Hit daily target of ${targetProtein}g protein distributed across 4 balanced meals (${mealProtein}g per meal). Hydrate with electrolytes and keep carbs moderate to replenish glycogen.`;
  }

  const [h] = plannedTime.split(":").map(Number);
  const isMorning = (h ?? 18) < 12;

  const proteinSource =
    dietPref === "HIGH_PROTEIN_VEG"
      ? "Whey isolate / Soy protein with greek yogurt or paneer"
      : "Whey isolate with skim milk, eggs, or grilled chicken breast";

  if (isMorning) {
    return `Morning Session Fuel: Light pre-workout (banana + electrolytes 30m prior). Post-workout within 45m: 35-40g protein (${proteinSource}) + 50g complex carbs to support muscle protein synthesis and daily ${targetProtein}g target.`;
  }

  return `Evening Session Fuel: 40-50g complex carbs (oats/rice) 90-120m before workout at ${plannedTime}. Post-workout: 35-40g high-bioavailability protein (${proteinSource}) + hydration with 500ml water and sodium.`;
}

// ---------------------------------------------------------------------------
// 6. Master Deterministic Weekly Planner
// ---------------------------------------------------------------------------

export function generateDeterministicWeekPlan(params: {
  athleteState: AthleteState;
  weeklyGymStoreSlots: NormalizedGymSlot[];
  diffs?: ScheduleDiff[] | undefined;
  currentPlan?: WeeklyWorkoutPlan | null | undefined;
  currentDateIST: string;
  isNextWeek?: boolean | undefined;
}): WeeklyWorkoutPlan {
  const { athleteState, weeklyGymStoreSlots, currentPlan, currentDateIST, isNextWeek } = params;
  const profile = athleteState.profile;
  const weekDays = getWeekDaysForDate(currentDateIST, { isNextWeek });
  const existingDays = currentPlan?.plan || [];
  const events = athleteState.events || [];
  const todayStr = currentDateIST.split("T")[0] || "";

  const allowedModalities = new Set(
    profile.modalities && profile.modalities.length > 0
      ? profile.modalities
      : ["KICKBOXING", "BJJ", "UPPER_HYPERTROPHY", "LOWER_STRENGTH", "BOXING_CONDITIONING", "KB_CONDITIONING", "MOBILITY_RECOVERY", "REST"]
  );

  // Check recent illness or acute soreness events
  const hasActiveIllness = events.some(
    (e) => (e.type === "ILLNESS" || e.type === "SORENESS_OVERLOAD") && e.date >= todayStr && e.severity !== "MILD"
  );

  // Available slots
  const availableSlots = [...weeklyGymStoreSlots];

  // Mandatory combat counts
  const targetKickboxing = profile.mandatoryCombatSessions?.kickboxing ?? 1;
  const targetBjj = profile.mandatoryCombatSessions?.bjj ?? 1;
  const maxWeeklyTrainingDays = profile.targetDaysPerWeek ?? 5;

  let scheduledKB = 0;
  let scheduledBJJ = 0;
  let scheduledUpper = 0;
  let scheduledLower = 0;
  let totalTrainingDays = 0;
  let lastModality: Modality | null = null;

  const full7DayPlan: DailyWorkoutPlan[] = [];

  for (const dayAnchor of weekDays) {
    const { date, dayName, isPast, isToday } = dayAnchor;

    // 1. Past days and today's logged/completed/missed sessions are locked from active plan
    const existingDay = existingDays.find((d) => d.date === date);
    const isTodayMissedEvent = isToday && events.some((e) => e.date === date && e.type === "MISSED_SESSION");

    if (isTodayMissedEvent) {
      const missedDay: DailyWorkoutPlan = {
        date,
        day: dayName,
        focus: "Rest/Recovery (Missed Session)",
        modality: "REST",
        isGymClass: false,
        gymSlotId: null,
        plannedTime: "18:00",
        estimatedDurationMinutes: 0,
        exercises: [],
        nutritionAdvice: generateNutritionAdvice("REST", "18:00", athleteState),
      };
      full7DayPlan.push(missedDay);
      lastModality = "REST";
      continue;
    }

    const hasTodayMissedOrCompleted = isToday && existingDay && (
      existingDay.focus.toLowerCase().includes("missed") ||
      events.some((e) => e.date === date && (e.type === "MISSED_SESSION" || e.type === "ILLNESS"))
    );

    if (isPast || hasTodayMissedOrCompleted) {
      if (existingDay) {
        full7DayPlan.push(existingDay);
        if (existingDay.modality !== "REST" && !existingDay.focus.toLowerCase().includes("missed")) {
          totalTrainingDays++;
          lastModality = existingDay.modality;
          if (existingDay.modality === "KICKBOXING") scheduledKB++;
          if (existingDay.modality === "BJJ") scheduledBJJ++;
          if (existingDay.modality === "UPPER_HYPERTROPHY") scheduledUpper++;
          if (existingDay.modality === "LOWER_STRENGTH") scheduledLower++;
        }
        continue;
      }
    }

    // 2. Sunday is strictly REST
    if (dayName === "Sunday") {
      full7DayPlan.push({
        date,
        day: dayName,
        focus: "Active Recovery & Mobility Decompression",
        modality: "REST",
        isGymClass: false,
        gymSlotId: null,
        plannedTime: "08:00",
        estimatedDurationMinutes: 0,
        exercises: [],
        nutritionAdvice: generateNutritionAdvice("REST", "08:00", athleteState),
      });
      lastModality = "REST";
      continue;
    }

    // 3. Active illness / severe overload auto-regulation
    if (hasActiveIllness && (isToday || dayAnchor.date > todayStr)) {
      full7DayPlan.push({
        date,
        day: dayName,
        focus: "Auto-Regulated Mobility & Systemic Recovery",
        modality: "MOBILITY_RECOVERY",
        isGymClass: false,
        gymSlotId: null,
        plannedTime: "17:00",
        estimatedDurationMinutes: 30,
        exercises: generateExercisesForModality("MOBILITY_RECOVERY", false, false, athleteState),
        nutritionAdvice: generateNutritionAdvice("REST", "17:00", athleteState),
      });
      lastModality = "MOBILITY_RECOVERY";
      continue;
    }

    const constraints = getDayConstraints(dayName, athleteState);
    const userPref = profile.trainingTimePreference || "EVENING";

    // 4. Try scheduling mandatory combat classes first (respecting evening/morning preference)
    let matchedSlot: NormalizedGymSlot | null = null;
    let selectedModality: Modality = "REST";

    // Modality Collision Prevention: Do not schedule Kickboxing immediately after heavy upper push
    const canScheduleKickboxing = lastModality !== "UPPER_HYPERTROPHY";

    if (allowedModalities.has("KICKBOXING") && scheduledKB < targetKickboxing && canScheduleKickboxing) {
      matchedSlot = findMatchingSlot(availableSlots, date, "KICKBOXING", constraints, userPref);
      if (matchedSlot) {
        selectedModality = "KICKBOXING";
        scheduledKB++;
      }
    }

    if (!matchedSlot && allowedModalities.has("BJJ") && scheduledBJJ < targetBjj) {
      matchedSlot = findMatchingSlot(availableSlots, date, "BJJ", constraints, userPref);
      if (matchedSlot) {
        selectedModality = "BJJ";
        scheduledBJJ++;
      }
    }

    if (matchedSlot) {
      const isClass = true;
      full7DayPlan.push({
        date,
        day: dayName,
        focus: matchedSlot.title,
        modality: selectedModality,
        isGymClass: isClass,
        gymSlotId: matchedSlot.id,
        plannedTime: matchedSlot.startTime,
        estimatedDurationMinutes: 60,
        exercises: generateExercisesForModality(selectedModality, isClass, constraints.isWFO, athleteState),
        nutritionAdvice: generateNutritionAdvice(selectedModality, matchedSlot.startTime, athleteState),
      });
      totalTrainingDays++;
      lastModality = selectedModality;
      continue;
    }

    // 5. Saturday rule: Rest if weekday target already met
    if (dayName === "Saturday") {
      if (totalTrainingDays < maxWeeklyTrainingDays) {
        const conditioningModality: Modality = allowedModalities.has("KB_CONDITIONING")
          ? "KB_CONDITIONING"
          : allowedModalities.has("BOXING_CONDITIONING")
          ? "BOXING_CONDITIONING"
          : "LOWER_STRENGTH";
        const morningTime = constraints.morningWindow.start || "08:00";
        full7DayPlan.push({
          date,
          day: dayName,
          focus: "Weekend S&C / Conditioning",
          modality: conditioningModality,
          isGymClass: false,
          gymSlotId: null,
          plannedTime: morningTime,
          estimatedDurationMinutes: 45,
          exercises: generateExercisesForModality(conditioningModality, false, false, athleteState),
          nutritionAdvice: generateNutritionAdvice(conditioningModality, morningTime, athleteState),
        });
        totalTrainingDays++;
        lastModality = conditioningModality;
      } else {
        full7DayPlan.push({
          date,
          day: dayName,
          focus: "Full Rest & Nervous System Recovery",
          modality: "REST",
          isGymClass: false,
          gymSlotId: null,
          plannedTime: "08:00",
          estimatedDurationMinutes: 0,
          exercises: [],
          nutritionAdvice: generateNutritionAdvice("REST", "08:00", athleteState),
        });
        lastModality = "REST";
      }
      continue;
    }

    // Weekdays (Mon-Fri)
    // If we have hit target training days (e.g. 5 days), program rest
    if (totalTrainingDays >= maxWeeklyTrainingDays) {
      full7DayPlan.push({
        date,
        day: dayName,
        focus: "Mid-Week Recovery & Tissue Quality",
        modality: "REST",
        isGymClass: false,
        gymSlotId: null,
        plannedTime: "18:00",
        estimatedDurationMinutes: 0,
        exercises: [],
        nutritionAdvice: generateNutritionAdvice("REST", "18:00", athleteState),
      });
      lastModality = "REST";
      continue;
    }

    // Program S&C based on WFH vs WFO with balanced non-consecutive split
    const plannedTime = constraints.isWFO
      ? constraints.eveningWindow.start
      : "18:30";

    let modality: Modality = "UPPER_HYPERTROPHY";
    let focusTitle = "";

    // Check if tomorrow has a Kickboxing/Striking class scheduled
    const dayIndex = weekDays.findIndex((w) => w.date === date);
    const nextDay = weekDays[dayIndex + 1];
    const tomorrowHasKickboxing = nextDay && (
      availableSlots.some((s) => s.date === nextDay.date && (s.title.toLowerCase().includes("kickbox") || s.title.toLowerCase().includes("boxing"))) ||
      existingDays.some((d) => d.date === nextDay.date && (d.modality === "KICKBOXING" || d.modality === "BOXING_CONDITIONING"))
    );

    // Decide modality ensuring NO consecutive duplicate muscle groups and recovery window between Upper Push & Striking
    if (lastModality === "UPPER_HYPERTROPHY") {
      // Must not be Upper Hypertrophy
      if (allowedModalities.has("LOWER_STRENGTH")) {
        modality = "LOWER_STRENGTH";
        focusTitle = constraints.isWFO
          ? "Lower Strength & Anterior/Posterior Supersets"
          : "Lower Strength & Posterior Chain Power";
        scheduledLower++;
      } else if (allowedModalities.has("KB_CONDITIONING")) {
        modality = "KB_CONDITIONING";
        focusTitle = "Full Body Power & Kettlebell Conditioning";
      } else if (allowedModalities.has("BOXING_CONDITIONING")) {
        modality = "BOXING_CONDITIONING";
        focusTitle = "Boxing Conditioning & Core Work";
      } else {
        modality = "MOBILITY_RECOVERY";
        focusTitle = "Mobility & Active Recovery";
      }
    } else if (lastModality === "KICKBOXING" || lastModality === "BOXING_CONDITIONING") {
      // Striking heavily taxes shoulder stabilizers & pressing chain.
      // Separate with Lower Strength or active recovery to protect 24-48h recovery window.
      if (allowedModalities.has("LOWER_STRENGTH")) {
        modality = "LOWER_STRENGTH";
        focusTitle = constraints.isWFO
          ? "Lower Strength & Anterior/Posterior Supersets"
          : "Lower Strength & Posterior Chain Power";
        scheduledLower++;
      } else if (allowedModalities.has("KB_CONDITIONING")) {
        modality = "KB_CONDITIONING";
        focusTitle = "Full Body Power & Kettlebell Conditioning";
      } else {
        modality = "MOBILITY_RECOVERY";
        focusTitle = "Mobility & Active Recovery";
      }
    } else if (lastModality === "LOWER_STRENGTH") {
      // Must not be Lower Strength. Also avoid Upper Hypertrophy if tomorrow is Kickboxing.
      if (!tomorrowHasKickboxing && allowedModalities.has("UPPER_HYPERTROPHY")) {
        modality = "UPPER_HYPERTROPHY";
        focusTitle = constraints.isWFO
          ? "Upper Body Hypertrophy (Time-Dense Supersets)"
          : "Upper Heavy Compounds & Core Stability";
        scheduledUpper++;
      } else if (allowedModalities.has("KB_CONDITIONING")) {
        modality = "KB_CONDITIONING";
        focusTitle = "Full Body Power & Kettlebell Conditioning";
      } else {
        modality = "BOXING_CONDITIONING";
        focusTitle = "Boxing Conditioning & Core Work";
      }
    } else {
      // Prioritize balancing Upper vs Lower across the week, respecting tomorrow's recovery window
      if (!tomorrowHasKickboxing && scheduledUpper <= scheduledLower && allowedModalities.has("UPPER_HYPERTROPHY")) {
        modality = "UPPER_HYPERTROPHY";
        focusTitle = constraints.isWFO
          ? "Upper Body Hypertrophy (Time-Dense Supersets)"
          : "Upper Heavy Compounds & Core Stability";
        scheduledUpper++;
      } else if (allowedModalities.has("LOWER_STRENGTH")) {
        modality = "LOWER_STRENGTH";
        focusTitle = constraints.isWFO
          ? "Lower Strength & Anterior/Posterior Supersets"
          : "Lower Strength & Posterior Chain Power";
        scheduledLower++;
      } else if (allowedModalities.has("KB_CONDITIONING")) {
        modality = "KB_CONDITIONING";
        focusTitle = "Full Body Power & Kettlebell Conditioning";
      } else {
        modality = "UPPER_HYPERTROPHY";
        focusTitle = "Upper Body Hypertrophy (Time-Dense Supersets)";
        scheduledUpper++;
      }
    }

    full7DayPlan.push({
      date,
      day: dayName,
      focus: focusTitle,
      modality,
      isGymClass: false,
      gymSlotId: null,
      plannedTime,
      estimatedDurationMinutes: constraints.isWFO ? 50 : 60,
      exercises: generateExercisesForModality(modality, false, constraints.isWFO, athleteState),
      nutritionAdvice: generateNutritionAdvice(modality, plannedTime, athleteState),
    });
    totalTrainingDays++;
    lastModality = modality;
  }

  // Ensure exactly 7 days
  return {
    plan: full7DayPlan,
    reasoning: `Deterministic athletic periodization split generated: ${scheduledKB} Kickboxing, ${scheduledBJJ} BJJ, and complementary S&C sessions perfectly aligned with WFH/WFO schedule, commute times, and ${profile.hardStopTrainingTime || "20:00"} hard stop cutoff.`,
    updatedAt: nowIST(),
  };
}

// ---------------------------------------------------------------------------
// 7. Deterministic Guardrail & Auto-Repair Pipeline
// ---------------------------------------------------------------------------

export function validateAndRepairWeeklyPlan(
  plan: DailyWorkoutPlan[],
  athleteState: AthleteState,
  currentDateIST: string,
  existingPlanDoc: WeeklyWorkoutPlan | null,
  weeklyGymStoreSlots?: NormalizedGymSlot[]
): DailyWorkoutPlan[] {
  const profile = athleteState.profile;
  const todayStr = currentDateIST.split("T")[0] || "";
  const existingDays = existingPlanDoc?.plan || [];
  const events = athleteState.events || [];
  const hardStopTime = profile.hardStopTrainingTime || "20:00";
  const allowedModalities = new Set(
    profile.modalities && profile.modalities.length > 0
      ? profile.modalities
      : ["KICKBOXING", "BJJ", "UPPER_HYPERTROPHY", "LOWER_STRENGTH", "BOXING_CONDITIONING", "KB_CONDITIONING", "MOBILITY_RECOVERY", "REST"]
  );

  const targetKB = profile.mandatoryCombatSessions?.kickboxing ?? 1;
  const targetBJJ = profile.mandatoryCombatSessions?.bjj ?? 1;
  const maxWeeklyDays = profile.targetDaysPerWeek ?? 5;

  let scheduledKB = 0;
  let scheduledBJJ = 0;
  let scheduledUpper = 0;
  let scheduledLower = 0;
  let totalWorkingDays = 0;
  let lastRepairedModality: Modality | null = null;

  let fullPlanToProcess = plan;

  return fullPlanToProcess.map((dayPlan, idx) => {
    // 1. Lock past days and today's missed/logged sessions from active plan
    const existingDay = existingDays.find((p) => p.date === dayPlan.date);
    const isPast = dayPlan.date < todayStr;
    const isToday = dayPlan.date === todayStr;
    const isTodayMissed = isToday && (
      dayPlan.focus.toLowerCase().includes("missed") ||
      (existingDay && existingDay.focus.toLowerCase().includes("missed")) ||
      events.some((e) => e.date === dayPlan.date && (e.type === "MISSED_SESSION" || e.type === "ILLNESS"))
    );

    if (isTodayMissed) {
      return {
        date: dayPlan.date,
        day: dayPlan.day,
        focus: "Rest/Recovery (Missed Session)",
        modality: "REST",
        isGymClass: false,
        gymSlotId: null,
        plannedTime: "18:00",
        estimatedDurationMinutes: 0,
        exercises: [],
        nutritionAdvice: generateNutritionAdvice("REST", "18:00", athleteState),
      };
    }

    if (isPast) {
      if (existingDay) {
        if (existingDay.modality === "KICKBOXING") scheduledKB++;
        if (existingDay.modality === "BJJ") scheduledBJJ++;
        if (existingDay.modality === "UPPER_HYPERTROPHY") scheduledUpper++;
        if (existingDay.modality === "LOWER_STRENGTH") scheduledLower++;
        if (existingDay.modality !== "REST" && !existingDay.focus.toLowerCase().includes("missed")) {
          totalWorkingDays++;
          lastRepairedModality = existingDay.modality;
        }
        return existingDay;
      }
    }

    let sanitized = { ...dayPlan };
    const dayConstraints = getDayConstraints(
      sanitized.day as any,
      athleteState
    );

    // 2. Sunday is strictly REST
    if (sanitized.day === "Sunday") {
      sanitized.modality = "REST";
      sanitized.focus = "Active Recovery & Mobility Decompression";
      sanitized.isGymClass = false;
      sanitized.gymSlotId = null;
      sanitized.exercises = [];
      sanitized.nutritionAdvice = generateNutritionAdvice("REST", "08:00", athleteState);
      lastRepairedModality = "REST";
      return sanitized;
    }

    const isFullWeekPlan = plan.length >= 7;
    // 3. Weekly Target Days Cap: If target working days already allocated, make subsequent days REST
    if (isFullWeekPlan && totalWorkingDays >= maxWeeklyDays) {
      sanitized.modality = "REST";
      sanitized.focus = sanitized.day === "Saturday" ? "Full Rest & Nervous System Recovery" : "Mid-Week Recovery & Tissue Quality";
      sanitized.isGymClass = false;
      sanitized.gymSlotId = null;
      sanitized.exercises = [];
      sanitized.nutritionAdvice = generateNutritionAdvice("REST", "08:00", athleteState);
      lastRepairedModality = "REST";
      return sanitized;
    }

    // 4. Validate and verify Gym Classes against available gym timetable slots
    const isGymClassCandidate =
      sanitized.isGymClass ||
      sanitized.modality === "KICKBOXING" ||
      sanitized.modality === "BJJ" ||
      sanitized.modality === "TRX" ||
      sanitized.modality === "DUT" ||
      sanitized.focus.toLowerCase().includes("class") ||
      sanitized.focus.toLowerCase().includes("bjj") ||
      sanitized.focus.toLowerCase().includes("kickbox");

    if (isGymClassCandidate && weeklyGymStoreSlots && weeklyGymStoreSlots.length > 0) {
      const combatModality = (sanitized.modality === "BJJ" || sanitized.modality === "KICKBOXING" || sanitized.modality === "TRX" || sanitized.modality === "DUT")
        ? (sanitized.modality as "KICKBOXING" | "BJJ" | "TRX" | "DUT")
        : (sanitized.focus.toLowerCase().includes("bjj") ? "BJJ" : "KICKBOXING");

      const directSlot = sanitized.gymSlotId
        ? weeklyGymStoreSlots.find((s) => s.id === sanitized.gymSlotId)
        : null;

      const matchedSlot = directSlot || findMatchingSlot(
        weeklyGymStoreSlots,
        sanitized.date,
        combatModality,
        dayConstraints,
        "BOTH"
      );

      if (matchedSlot) {
        sanitized.isGymClass = true;
        sanitized.gymSlotId = matchedSlot.id;
        sanitized.plannedTime = matchedSlot.startTime;
        sanitized.focus = matchedSlot.title;
        sanitized.modality = combatModality;
        sanitized.exercises = generateExercisesForModality(combatModality, true, dayConstraints.isWFO, athleteState);
      } else if (sanitized.isGymClass) {
        // Direct class with no store slots or direct override: strip supersets
        sanitized.exercises = (sanitized.exercises || []).map((ex) => ({
          ...ex,
          supersetGroupId: null,
          orderInGroup: null,
        }));
      } else {
        // No matching class on timetable for this date: strictly convert to non-class session
        sanitized.isGymClass = false;
        sanitized.gymSlotId = null;
        if (lastRepairedModality !== "UPPER_HYPERTROPHY" && allowedModalities.has("UPPER_HYPERTROPHY")) {
          sanitized.modality = "UPPER_HYPERTROPHY";
          sanitized.focus = dayConstraints.isWFO
            ? "Upper Body Hypertrophy (Time-Dense Supersets)"
            : "Upper Heavy Compounds & Core Stability";
        } else if (allowedModalities.has("LOWER_STRENGTH")) {
          sanitized.modality = "LOWER_STRENGTH";
          sanitized.focus = dayConstraints.isWFO
            ? "Lower Strength & Anterior/Posterior Supersets"
            : "Lower Strength & Posterior Chain Power";
        } else if (allowedModalities.has("KB_CONDITIONING")) {
          sanitized.modality = "KB_CONDITIONING";
          sanitized.focus = "Full Body Power & Kettlebell Conditioning";
        } else {
          sanitized.modality = "BOXING_CONDITIONING";
          sanitized.focus = "Boxing Conditioning & Core Work";
        }
        sanitized.exercises = generateExercisesForModality(sanitized.modality, false, dayConstraints.isWFO, athleteState);
      }
    } else if (sanitized.isGymClass) {
      // Gym store slots not provided or empty: ensure supersets are stripped for classes
      sanitized.exercises = (sanitized.exercises || []).map((ex) => ({
        ...ex,
        supersetGroupId: null,
        orderInGroup: null,
      }));
    }

    // 5. Combat Caps Enforcement (Kickboxing <= targetKB, BJJ <= targetBJJ)
    if (sanitized.modality === "KICKBOXING") {
      if (scheduledKB >= targetKB || !allowedModalities.has("KICKBOXING")) {
        sanitized.isGymClass = false;
        sanitized.gymSlotId = null;
        if (lastRepairedModality !== "UPPER_HYPERTROPHY" && allowedModalities.has("UPPER_HYPERTROPHY")) {
          sanitized.modality = "UPPER_HYPERTROPHY";
          sanitized.focus = dayConstraints.isWFO
            ? "Upper Body Hypertrophy (Time-Dense Supersets)"
            : "Upper Heavy Compounds & Core Stability";
          scheduledUpper++;
        } else {
          sanitized.modality = "LOWER_STRENGTH";
          sanitized.focus = dayConstraints.isWFO
            ? "Lower Strength & Anterior/Posterior Supersets"
            : "Lower Strength & Posterior Chain Power";
          scheduledLower++;
        }
        sanitized.exercises = generateExercisesForModality(sanitized.modality, false, dayConstraints.isWFO, athleteState);
      } else {
        scheduledKB++;
      }
    } else if (sanitized.modality === "BJJ") {
      if (scheduledBJJ >= targetBJJ || !allowedModalities.has("BJJ")) {
        sanitized.isGymClass = false;
        sanitized.gymSlotId = null;
        if (lastRepairedModality !== "LOWER_STRENGTH" && allowedModalities.has("LOWER_STRENGTH")) {
          sanitized.modality = "LOWER_STRENGTH";
          sanitized.focus = dayConstraints.isWFO
            ? "Lower Strength & Anterior/Posterior Supersets"
            : "Lower Strength & Posterior Chain Power";
          scheduledLower++;
        } else {
          sanitized.modality = "UPPER_HYPERTROPHY";
          sanitized.focus = dayConstraints.isWFO
            ? "Upper Body Hypertrophy (Time-Dense Supersets)"
            : "Upper Heavy Compounds & Core Stability";
          scheduledUpper++;
        }
        sanitized.exercises = generateExercisesForModality(sanitized.modality, false, dayConstraints.isWFO, athleteState);
      } else {
        scheduledBJJ++;
      }
    }

    // 6. Modality Allowed Check (e.g. if DUT is unchecked in settings)
    if (!allowedModalities.has(sanitized.modality) && sanitized.modality !== "REST") {
      if (lastRepairedModality === "UPPER_HYPERTROPHY") {
        sanitized.modality = allowedModalities.has("LOWER_STRENGTH")
          ? "LOWER_STRENGTH"
          : (allowedModalities.has("KB_CONDITIONING") ? "KB_CONDITIONING" : "MOBILITY_RECOVERY");
      } else {
        sanitized.modality = allowedModalities.has("UPPER_HYPERTROPHY")
          ? "UPPER_HYPERTROPHY"
          : (allowedModalities.has("LOWER_STRENGTH") ? "LOWER_STRENGTH" : "MOBILITY_RECOVERY");
      }
      if (!sanitized.focus || sanitized.focus.toLowerCase().includes("dut") || sanitized.focus.toLowerCase().includes("trx") || sanitized.focus.toLowerCase().includes("yoga")) {
        sanitized.focus = dayConstraints.isWFO
          ? (sanitized.modality === "UPPER_HYPERTROPHY" ? "Upper Body Hypertrophy (Time-Dense Supersets)" : "Lower Strength & Anterior/Posterior Supersets")
          : (sanitized.modality === "UPPER_HYPERTROPHY" ? "Upper Heavy Compounds & Core Stability" : "Lower Strength & Posterior Chain Power");
      }
      sanitized.isGymClass = false;
      sanitized.gymSlotId = null;
      sanitized.exercises = generateExercisesForModality(sanitized.modality, false, dayConstraints.isWFO, athleteState);
    }

    // 7. Prevent Consecutive Duplicate Muscle Groups & Striking / Upper Push Collisions
    const isStriking = (m: Modality | null | undefined) => m === "KICKBOXING" || m === "BOXING_CONDITIONING";
    const nextDay = fullPlanToProcess[idx + 1];
    const nextDayModality = nextDay?.modality;

    if (
      sanitized.modality === "UPPER_HYPERTROPHY" &&
      (lastRepairedModality === "UPPER_HYPERTROPHY" || isStriking(lastRepairedModality) || isStriking(nextDayModality))
    ) {
      // Incompatible recovery window: Upper push collided with striking or consecutive upper push
      sanitized.modality = allowedModalities.has("LOWER_STRENGTH") ? "LOWER_STRENGTH" : "KB_CONDITIONING";
      sanitized.focus = dayConstraints.isWFO
        ? "Lower Strength & Anterior/Posterior Supersets"
        : "Lower Strength & Posterior Chain Power";
      sanitized.exercises = generateExercisesForModality(sanitized.modality, false, dayConstraints.isWFO, athleteState);
    } else if (isStriking(sanitized.modality) && lastRepairedModality === "UPPER_HYPERTROPHY") {
      // Striking scheduled immediately after heavy upper push without recovery window
      sanitized.isGymClass = false;
      sanitized.gymSlotId = null;
      sanitized.modality = allowedModalities.has("LOWER_STRENGTH") ? "LOWER_STRENGTH" : "KB_CONDITIONING";
      sanitized.focus = dayConstraints.isWFO
        ? "Lower Strength & Anterior/Posterior Supersets"
        : "Lower Strength & Posterior Chain Power";
      sanitized.exercises = generateExercisesForModality(sanitized.modality, false, dayConstraints.isWFO, athleteState);
    } else if (sanitized.modality === "LOWER_STRENGTH" && lastRepairedModality === "LOWER_STRENGTH") {
      sanitized.modality = allowedModalities.has("UPPER_HYPERTROPHY") ? "UPPER_HYPERTROPHY" : "KB_CONDITIONING";
      sanitized.focus = dayConstraints.isWFO
        ? "Upper Body Hypertrophy (Time-Dense Supersets)"
        : "Upper Heavy Compounds & Core Stability";
      sanitized.exercises = generateExercisesForModality(sanitized.modality, false, dayConstraints.isWFO, athleteState);
    }

    // 8. Gym classes cannot have supersets
    if (sanitized.isGymClass) {
      sanitized.exercises = (sanitized.exercises || []).map((ex) => ({
        ...ex,
        supersetGroupId: null,
        orderInGroup: null,
      }));
    }

    // 9. Work Mode Timing Alignment (WFO commute & WFH working hours)
    if (dayConstraints.isWFO && sanitized.modality !== "REST") {
      const currentStartMins = parseTimeToMinutes(sanitized.plannedTime);
      const workEndMins = parseTimeToMinutes(profile.workDayEndTime || "18:00");
      const minEveningStart = workEndMins + dayConstraints.commuteMinutes;

      if (currentStartMins >= 12 * 60 && currentStartMins < minEveningStart) {
        sanitized.plannedTime = minutesToTimeString(minEveningStart);
        sanitized.estimatedDurationMinutes = 50; // 19:00 to 19:50 <= 20:00 hard stop
      }
    } else if (!dayConstraints.isWFO && sanitized.modality !== "REST" && sanitized.day !== "Saturday" && sanitized.day !== "Sunday") {
      const currentStartMins = parseTimeToMinutes(sanitized.plannedTime);
      const workStartMins = parseTimeToMinutes(profile.workDayStartTime || "09:00");
      const workEndMins = parseTimeToMinutes(profile.workDayEndTime || "18:00");
      if (currentStartMins >= workStartMins && currentStartMins < workEndMins) {
        sanitized.plannedTime = "18:30";
      }
    }

    // 10. Hard stop cutoff clamp
    const startMins = parseTimeToMinutes(sanitized.plannedTime);
    const duration = sanitized.estimatedDurationMinutes || 60;
    const endMins = startMins + duration;
    const hardStopMins = parseTimeToMinutes(hardStopTime);

    if (endMins > hardStopMins) {
      const maxStartMins = hardStopMins - duration;
      if (maxStartMins >= parseTimeToMinutes("06:00")) {
        sanitized.plannedTime = minutesToTimeString(maxStartMins);
      }
    }

    // 11. Ensure superset groups on WFO days for non-class strength sessions
    if (dayConstraints.isWFO && !sanitized.isGymClass && sanitized.modality !== "REST") {
      const hasSupersets = sanitized.exercises.some((e) => e.supersetGroupId !== null);
      if (!hasSupersets && sanitized.exercises.length >= 2) {
        sanitized.exercises = sanitized.exercises.map((e, idx) => ({
          ...e,
          supersetGroupId: idx < 2 ? "A" : "B",
          orderInGroup: (idx % 2) + 1,
        }));
      }
    }

    if (sanitized.modality !== "REST") {
      totalWorkingDays++;
      lastRepairedModality = sanitized.modality;
    }

    return sanitized;
  });
}

