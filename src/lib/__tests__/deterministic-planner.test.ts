import { describe, it, expect } from "vitest";
import {
  generateDeterministicWeekPlan,
  validateAndRepairWeeklyPlan,
  getDayConstraints,
  findMatchingSlot,
} from "@/lib/deterministic-planner";
import { type AthleteState } from "@/types/agent";
import { type NormalizedGymSlot } from "@/types/gym";

describe("Deterministic Constraint & Plan Solver", () => {
  const athleteState: AthleteState = {
    profile: {
      userId: "user_test",
      weightKg: 69,
      heightCm: 169,
      targetDaysPerWeek: 5,
      weightUnitPreference: "KG",
      mandatoryCombatSessions: { kickboxing: 1, bjj: 1 },
      weeklyWorkSchedule: {
        Monday: { mode: "WFH", commuteMinutesOneWay: 30 },
        Tuesday: { mode: "WFO", commuteMinutesOneWay: 65 },
        Wednesday: { mode: "WFH", commuteMinutesOneWay: 30 },
        Thursday: { mode: "WFO", commuteMinutesOneWay: 65 },
        Friday: { mode: "WFH", commuteMinutesOneWay: 30 },
        Saturday: { mode: "WFH", commuteMinutesOneWay: 30 },
        Sunday: { mode: "WFH", commuteMinutesOneWay: 30 },
      },
      modalities: ["KICKBOXING", "BJJ", "UPPER_HYPERTROPHY", "LOWER_STRENGTH", "KB_CONDITIONING", "REST", "MOBILITY_RECOVERY"],
      dietaryPreference: "HIGH_PROTEIN_NON_VEG",
      targetDailyProteinGrams: 125,
      workDayStartTime: "09:00",
      workDayEndTime: "18:00",
      trainingTimePreference: "BOTH",
      hardStopTrainingTime: "20:00",
      hardStopWindow: "EVENING",
    },
    lifts: [
      {
        date: "2026-08-17",
        exerciseName: "Barbell Bench Press",
        sets: [{ setNumber: 1, weight: 60, unit: "KG", repsCompleted: 6, rpe: 8 }],
        notes: "Good velocity",
      },
    ],
    events: [],
  };

  const sampleSlots: NormalizedGymSlot[] = [
    {
      id: "slot_kb_mon",
      date: "2026-08-24",
      startTime: "19:00",
      endTime: "20:00",
      title: "Kickboxing / S&C",
      trainer: "Vikram",
    },
    {
      id: "slot_bjj_wed",
      date: "2026-08-26",
      startTime: "19:00",
      endTime: "20:00",
      title: "BJJ Ground Game",
      trainer: "Marcus",
    },
  ];

  it("calculates accurate day constraints for WFO vs WFH", () => {
    const monConstraints = getDayConstraints("Monday", athleteState);
    expect(monConstraints.isWFO).toBe(false);
    expect(monConstraints.commuteMinutes).toBe(0);

    const tueConstraints = getDayConstraints("Tuesday", athleteState);
    expect(tueConstraints.isWFO).toBe(true);
    expect(tueConstraints.commuteMinutes).toBe(65);
    // Work ends at 18:00 + 65 min commute = earliest gym arrival 19:05
    expect(tueConstraints.eveningWindow.start).toBe("19:05");
  });

  it("filters out slots violating hard stop cutoff on WFO days", () => {
    const tueConstraints = getDayConstraints("Tuesday", athleteState);
    // Slot ending at 19:30 + 65m commute = 20:35 > 20:00 hard stop
    const lateSlot: NormalizedGymSlot = {
      id: "late_kb",
      date: "2026-08-25",
      startTime: "18:30",
      endTime: "19:30",
      title: "Kickboxing",
      trainer: "Coach",
    };
    const matched = findMatchingSlot([lateSlot], "2026-08-25", "KICKBOXING", tueConstraints);
    expect(matched).toBeNull();
  });

  it("generates a 100% compliant 7-day plan with 5 training days and Sunday REST", () => {
    const weekPlan = generateDeterministicWeekPlan({
      athleteState,
      weeklyGymStoreSlots: sampleSlots,
      currentDateIST: "2026-08-24T06:30:00+05:30",
    });

    expect(weekPlan.plan).toHaveLength(7);
    const trainingDays = weekPlan.plan.filter((d) => d.modality !== "REST");
    expect(trainingDays).toHaveLength(5);

    const sunday = weekPlan.plan.find((d) => d.day === "Sunday");
    expect(sunday?.modality).toBe("REST");

    const monday = weekPlan.plan.find((d) => d.date === "2026-08-24");
    expect(monday?.gymSlotId).toBe("slot_kb_mon");
    expect(monday?.modality).toBe("KICKBOXING");
    expect(monday?.isGymClass).toBe(true);

    const wednesday = weekPlan.plan.find((d) => d.date === "2026-08-26");
    expect(wednesday?.gymSlotId).toBe("slot_bjj_wed");
    expect(wednesday?.modality).toBe("BJJ");

    // Check progressive overload calculation for bench press
    const upperDay = weekPlan.plan.find((d) => d.modality === "UPPER_HYPERTROPHY");
    const benchEx = upperDay?.exercises.find((e) => e.name.includes("Bench"));
    expect(benchEx?.weightKg).toBe(62.5); // +2.5kg over 60kg past lift
    expect(benchEx?.progressionNote).toContain("+2.5 kg");
  });

  it("auto-regulates plan when acute illness is logged", () => {
    const sickState: AthleteState = {
      ...athleteState,
      events: [
        {
          date: "2026-08-24",
          type: "ILLNESS",
          severity: "SEVERE",
          notes: "Viral fever and acute body ache",
        },
      ],
    };

    const plan = generateDeterministicWeekPlan({
      athleteState: sickState,
      weeklyGymStoreSlots: sampleSlots,
      currentDateIST: "2026-08-24T08:00:00+05:30",
    });

    const monday = plan.plan.find((d) => d.date === "2026-08-24");
    expect(monday?.modality).toBe("MOBILITY_RECOVERY");
  });

  it("validates and repairs illegal plans from rogue LLM generations", () => {
    const roguePlan = [
      {
        date: "2026-08-30",
        day: "Sunday",
        focus: "Heavy Deadlifts",
        modality: "LOWER_STRENGTH" as const,
        isGymClass: false,
        plannedTime: "21:30",
        exercises: [{ name: "Deadlift", sets: 5, reps: "5" }],
        nutritionAdvice: "Fuel up",
      },
    ];

    const repaired = validateAndRepairWeeklyPlan(
      roguePlan as any,
      athleteState,
      "2026-08-24T08:00:00+05:30",
      null
    );

    expect(repaired[0]?.modality).toBe("REST");
    expect(repaired[0]?.exercises).toHaveLength(0);
  });
});
