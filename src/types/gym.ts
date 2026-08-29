/**
 * @file src/types/gym.ts
 * @spec SPEC-001 – Data Contracts & Schema Validation
 *
 * All Zod schemas and inferred TypeScript types for raw gym API responses and
 * their normalised internal representations. Nothing in this file may reach
 * the browser – it is server-only validation logic.
 *
 * Ground truth: fixtures/raw-auth-response.json
 *               fixtures/raw-schedules-response.json
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Custom error thrown when a Zod safeParse fails at an external boundary. */
export class ValidationError extends Error {
  public readonly issues: z.core.$ZodIssue[];

  constructor(message: string, issues: z.core.$ZodIssue[]) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/**
 * Trims the seconds component from an HH:MM:SS time string returned by the
 * gym API (e.g. "09:00:00" → "09:00").
 */
const trimSeconds = (raw: string): string => raw.slice(0, 5);

// ---------------------------------------------------------------------------
// A. Auth Schemas
// ---------------------------------------------------------------------------

/**
 * Input schema for the "request OTP" step.
 * Validates the body sent from our UI to our own API route.
 */
export const RequestOtpInputSchema = z.object({
  email: z.email(),
});

export type RequestOtpInput = z.infer<typeof RequestOtpInputSchema>;

/**
 * Input schema for the "verify OTP" step.
 * Validates the body sent from our UI to our own API route.
 */
export const VerifyOtpInputSchema = z.object({
  email: z.email(),
  otp: z.string().min(1),
});

export type VerifyOtpInput = z.infer<typeof VerifyOtpInputSchema>;

/**
 * Validates the raw JSON body returned by the gym's OTP verification endpoint.
 *
 * Shape (from fixtures/raw-auth-response.json):
 *   access_token, role, available_roles[], user_id, passkey_registration { ... }
 *
 * passkey_registration is captured but intentionally stripped during
 * transformation – it is NEVER forwarded to the browser.
 */
export const RawAuthResponseSchema = z.object({
  access_token: z.string().min(1),
  role: z.string().min(1),
  available_roles: z.array(z.string()),
  user_id: z.string().min(1),
  // Captured for type-safety; contents are stripped in toAuthSession().
  passkey_registration: z.record(z.string(), z.unknown()).optional(),
});

export type RawAuthResponse = z.infer<typeof RawAuthResponseSchema>;

/**
 * Clean, internal session state stored in Redis and encoded into the
 * HttpOnly session cookie. Contains NO WebAuthn / passkey material.
 */
export const AuthSessionSchema = z.object({
  userId: z.string().min(1),
  role: z.string().min(1),
  accessToken: z.string().min(1),
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;

/**
 * Transforms a validated {@link RawAuthResponse} into an {@link AuthSession},
 * dropping all WebAuthn / passkey fields.
 */
export function toAuthSession(raw: RawAuthResponse): AuthSession {
  return {
    userId: raw.user_id,
    role: raw.role,
    accessToken: raw.access_token,
  };
}

// ---------------------------------------------------------------------------
// B. Gym Schedule Schemas
// ---------------------------------------------------------------------------

/**
 * Validates a single raw slot object as returned by the gym's schedule
 * endpoint (fixtures/raw-schedules-response.json).
 *
 * Retained fields only – no invented keys.
 */
export const RawGymSlotSchema = z.object({
  id: z.string().min(1),
  scheduled_date: z.iso.date(),                  // "YYYY-MM-DD"
  time_from: z.string().regex(/^\d{2}:\d{2}:\d{2}$/), // "HH:MM:SS"
  time_to: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),   // "HH:MM:SS"
  capacity: z.number().int().nonnegative(),
  available_slots: z.number().int().nonnegative(),
  status: z.string().min(1),
  is_active: z.boolean(),
  created_at: z.string().min(1),                 // ISO-like datetime from API
  class_name: z.string().min(1),
  class_description: z.string(),
  normal_variants: z.string().nullable(),
  coach_name: z.string().min(1),
});

export type RawGymSlot = z.infer<typeof RawGymSlotSchema>;

/**
 * Validates the top-level schedule response, which is a plain JSON array.
 * An empty array is valid and results in no slots.
 */
export const RawScheduleResponseSchema = z.array(RawGymSlotSchema);

export type RawScheduleResponse = z.infer<typeof RawScheduleResponseSchema>;

/**
 * Compact, LLM-ready slot representation. All redundant boilerplate is
 * stripped; times are normalised to HH:MM 24-hour IST format.
 */
export const NormalizedGymSlotSchema = z.object({
  id: z.string().min(1),
  date: z.iso.date(),                            // "YYYY-MM-DD" IST – from scheduled_date
  startTime: z.string().regex(/^\d{2}:\d{2}$/), // "HH:MM" 24-hr IST
  endTime: z.string().regex(/^\d{2}:\d{2}$/),   // "HH:MM" 24-hr IST
  title: z.string().min(1),                      // from class_name
  trainer: z.string().min(1),                    // from coach_name
});

export type NormalizedGymSlot = z.infer<typeof NormalizedGymSlotSchema>;

// ---------------------------------------------------------------------------
// C. Schedule Diff & Weekly Store Schemas (SPEC-003)
// ---------------------------------------------------------------------------

/**
 * Represents a detected change between two schedule snapshots.
 * Generated by the diffing service when a future slot is cancelled, shifted,
 * or newly added relative to the last cached snapshot.
 */
export const ScheduleDiffSchema = z.object({
  type: z.enum(["CANCELLED", "RESCHEDULED", "NEW"]),
  slotId: z.string().min(1),
  title: z.string().min(1),
  date: z.iso.date(),                            // "YYYY-MM-DD" IST
  originalTime: z.string().regex(/^\d{2}:\d{2}$/), // "HH:MM" 24-hr IST
  updatedTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  detectedAt: z.string().min(1),                 // ISO 8601 IST
});

export type ScheduleDiff = z.infer<typeof ScheduleDiffSchema>;

/**
 * The full document stored in Redis under `schedule:week:{year}_W{weekNumber}`.
 * Merges the canonical slot list with all detected diffs and fetch metadata.
 */
export const WeeklyScheduleStoreSchema = z.object({
  lastFetchedAt: z.string().min(1), // ISO 8601 IST
  slots: z.array(NormalizedGymSlotSchema),
  diffs: z.array(ScheduleDiffSchema),
});

export type WeeklyScheduleStore = z.infer<typeof WeeklyScheduleStoreSchema>;

// ---------------------------------------------------------------------------
// D. Schedule Normalizer
// ---------------------------------------------------------------------------

/**
 * Validates and normalises a raw gym schedule payload.
 *
 * - Runs {@link RawScheduleResponseSchema.safeParse} on the unknown input.
 * - On failure, throws a {@link ValidationError} with detailed Zod issue paths.
 * - On success, maps each slot to a compact {@link NormalizedGymSlot}.
 * - Returns an empty array when the schedule data is null or undefined.
 *
 * @param raw - Unknown payload received directly from the gym API.
 * @returns Array of normalised gym slots ready for Redis caching and LLM use.
 * @throws {ValidationError} when the payload does not conform to the schema.
 */
export function normalizeSchedulePayload(raw: unknown): NormalizedGymSlot[] {
  // Treat null / undefined as an empty schedule rather than an error.
  if (raw === null || raw === undefined) {
    return [];
  }

  const result = RawScheduleResponseSchema.safeParse(raw);

  if (!result.success) {
    throw new ValidationError(
      "gym schedule payload failed schema validation",
      result.error.issues,
    );
  }

  return result.data.map((slot): NormalizedGymSlot => ({
    id: slot.id,
    date: slot.scheduled_date,
    startTime: trimSeconds(slot.time_from),
    endTime: trimSeconds(slot.time_to),
    title: slot.class_name,
    trainer: slot.coach_name,
  }));
}
