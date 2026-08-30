/**
 * @file src/types/agent.ts
 * @spec SPEC-004 – AI Coach Engine & Adaptive Planning Workflow
 *
 * Zod schemas and inferred TypeScript types for the AI Coach Agent Engine,
 * including consolidated athlete state and weekly plans.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// A. Fundamental Enums & Common Types
// ---------------------------------------------------------------------------

export const WorkModeSchema = z.enum(["WFH", "WFO"]);
export type WorkMode = z.infer<typeof WorkModeSchema>;

export const DietPreferenceSchema = z.enum([
  "HIGH_PROTEIN_NON_VEG",
  "HIGH_PROTEIN_VEG",
  "BALANCED",
]);
export type DietPreference = z.infer<typeof DietPreferenceSchema>;

export const WeightUnitSchema = z.enum(["KG", "LBS"]);
export type WeightUnit = z.infer<typeof WeightUnitSchema>;

export const ModalitySchema = z.enum([
  "KICKBOXING",
  "BJJ",
  "UPPER_HYPERTROPHY",
  "LOWER_STRENGTH",
  "BOXING_CONDITIONING",
  "KB_CONDITIONING",
  "DUT",
  "TRX",
  "AB_ASSAULT",
  "MOBILITY_RECOVERY",
  "REST",
]);
export type Modality = z.infer<typeof ModalitySchema>;

// ---------------------------------------------------------------------------
// B. Athlete Profile & Health Schemas
// ---------------------------------------------------------------------------

export const AthleteProfileSchema = z.object({
  userId: z.string().min(1),
  weightKg: z.number().positive(),
  heightCm: z.number().positive(),
  targetDaysPerWeek: z.literal(5),
  weightUnitPreference: WeightUnitSchema,
  mandatoryCombatSessions: z.object({
    kickboxing: z.number().nonnegative(),
    bjj: z.number().nonnegative(),
  }),
  weeklyWorkSchedule: z.record(
    z.enum([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]),
    z.object({
      mode: WorkModeSchema,
      commuteMinutesOneWay: z.number().nonnegative(),
    })
  ),
  modalities: z.array(ModalitySchema),
  dietaryPreference: DietPreferenceSchema,
  targetDailyProteinGrams: z.number().positive(),
});
export type AthleteProfile = z.infer<typeof AthleteProfileSchema>;

// ---------------------------------------------------------------------------
// C. Lift History & Progressive Overload Schemas
// ---------------------------------------------------------------------------

export const ExerciseSetRecordSchema = z.object({
  setNumber: z.number().int().positive(),
  weight: z.number().nonnegative(),
  unit: WeightUnitSchema,
  repsCompleted: z.number().int().nonnegative(),
  rpe: z.number().min(1).max(10).optional().nullable(),
});
export type ExerciseSetRecord = z.infer<typeof ExerciseSetRecordSchema>;

export const LiftRecordSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD IST
  exerciseName: z.string().min(1),
  sets: z.array(ExerciseSetRecordSchema),
  notes: z.string().optional().nullable(),
});
export type LiftRecord = z.infer<typeof LiftRecordSchema>;

// ---------------------------------------------------------------------------
// D. Athlete Events (illness, missed session, travel etc.)
// ---------------------------------------------------------------------------

export const AthleteEventTypeSchema = z.enum([
  "ILLNESS",
  "MISSED_SESSION",
  "SORENESS_OVERLOAD",
  "TRAVEL_WORK",
]);
export type AthleteEventType = z.infer<typeof AthleteEventTypeSchema>;

export const AthleteEventSeveritySchema = z.enum(["MILD", "MODERATE", "SEVERE"]);
export type AthleteEventSeverity = z.infer<typeof AthleteEventSeveritySchema>;

export const AthleteEventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD IST
  type: AthleteEventTypeSchema,
  severity: AthleteEventSeveritySchema,
  notes: z.string(),
});
export type AthleteEvent = z.infer<typeof AthleteEventSchema>;

// ---------------------------------------------------------------------------
// E. Consolidated Athlete State Schema
// ---------------------------------------------------------------------------

export const AthleteStateSchema = z.object({
  profile: AthleteProfileSchema,
  lifts: z.array(LiftRecordSchema),
  events: z.array(AthleteEventSchema),
});
export type AthleteState = z.infer<typeof AthleteStateSchema>;

// ---------------------------------------------------------------------------
// F. Weekly Workout Plan Schema
// ---------------------------------------------------------------------------

export const PlannedExerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.number().int().positive(),
  reps: z.string().min(1),
  targetWeight: z.number().nonnegative().optional().nullable(),
  unit: WeightUnitSchema,
  targetRpe: z.number().min(1).max(10).optional().nullable(),
  restSeconds: z.number().int().nonnegative(),
  supersetGroupId: z.string().optional().nullable(),
  orderInGroup: z.number().int().positive().optional().nullable(),
  progressionNote: z.string().optional().nullable(),
});
export type PlannedExercise = z.infer<typeof PlannedExerciseSchema>;

export const DailyWorkoutPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day: z.string().min(1),
  focus: z.string().min(1),
  modality: ModalitySchema,
  isGymClass: z.boolean(),
  gymSlotId: z.string().optional().nullable(),
  plannedTime: z.string().regex(/^\d{2}:\d{2}$/), // HH:mm
  estimatedDurationMinutes: z.number().nonnegative().optional().nullable(),
  exercises: z.array(PlannedExerciseSchema),
  nutritionAdvice: z.string(),
});
export type DailyWorkoutPlan = z.infer<typeof DailyWorkoutPlanSchema>;

export const WeeklyWorkoutPlanSchema = z.object({
  plan: z.array(DailyWorkoutPlanSchema),
  reasoning: z.string(),
  updatedAt: z.string().min(1), // ISO 8601 IST
});
export type WeeklyWorkoutPlan = z.infer<typeof WeeklyWorkoutPlanSchema>;

// ---------------------------------------------------------------------------
// G. Tool Input Validation Schemas
// ---------------------------------------------------------------------------

export const ReplanWeekScheduleArgsSchema = z.object({
  plan: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      day: z.string().min(1),
      focus: z.string().min(1),
      modality: ModalitySchema,
      isGymClass: z.boolean(),
      gymSlotId: z.string().optional().nullable(),
      plannedTime: z.string().regex(/^\d{2}:\d{2}$/),
      estimatedDurationMinutes: z.number().nonnegative().optional().nullable(),
      exercises: z.array(PlannedExerciseSchema),
      nutritionAdvice: z.string(),
    })
  ),
  reasoning: z.string(),
});

export const LogLiftPerformanceArgsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exerciseName: z.string().min(1),
  unit: WeightUnitSchema,
  sets: z.array(
    z.object({
      setNumber: z.number().int().positive(),
      weight: z.number().nonnegative(),
      repsCompleted: z.number().int().nonnegative(),
      rpe: z.number().min(1).max(10).optional().nullable(),
    })
  ),
  notes: z.string().optional().nullable(),
});

export const LogAthleteEventArgsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: AthleteEventTypeSchema,
  severity: AthleteEventSeveritySchema,
  notes: z.string(),
});
