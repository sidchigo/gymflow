/**
 * @file src/lib/gym-client-mock.ts
 * @spec SPEC-002 – Auth & Token Management
 *
 * Fixture-backed mock gym client.
 * Used when `GYM_USE_MOCK=true` so the app runs without live gym credentials.
 *
 * Fixture sources:
 *   fixtures/raw-auth-response.json   – returned by verifyOtp()
 *   fixtures/raw-schedules-response.json – returned by getSchedule()
 *
 * The mock simulates:
 *   - OTP acceptance for any (email, "000000") pair.
 *   - OTP rejection (GymAuthError) for any other OTP string.
 *   - requestOtp() always succeeds silently.
 *   - getSchedule() returns all fixture slots regardless of date range.
 */

import {
  RawAuthResponseSchema,
  RawScheduleResponseSchema,
  type RawAuthResponse,
  type RawScheduleResponse,
  ValidationError,
} from "@/types/gym";
import { GymAuthError, type IGymClient } from "@/lib/gym-client";
import rawAuthFixture from "../../fixtures/raw-auth-response.json";
import rawScheduleFixture from "../../fixtures/raw-schedules-response.json";

// ---------------------------------------------------------------------------
// Validate fixtures at module load time
// ---------------------------------------------------------------------------

const authFixtureResult = RawAuthResponseSchema.safeParse(rawAuthFixture);
if (!authFixtureResult.success) {
  throw new ValidationError(
    "raw-auth-response.json failed schema validation — fix the fixture",
    authFixtureResult.error.issues,
  );
}
const AUTH_FIXTURE: RawAuthResponse = authFixtureResult.data;

const scheduleFixtureResult =
  RawScheduleResponseSchema.safeParse(rawScheduleFixture);
if (!scheduleFixtureResult.success) {
  throw new ValidationError(
    "raw-schedules-response.json failed schema validation — fix the fixture",
    scheduleFixtureResult.error.issues,
  );
}
const SCHEDULE_FIXTURE: RawScheduleResponse = scheduleFixtureResult.data;

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

/** Valid OTP accepted by the mock. Any other value triggers GymAuthError. */
const MOCK_VALID_OTP = "000000";

export class MockGymClient implements IGymClient {
  async requestOtp(_email: string): Promise<void> {
    // No-op: pretend the gym sent an OTP email.
    // In dev, just use MOCK_VALID_OTP ("000000") in the verify step.
    console.info(
      `[MockGymClient] requestOtp called. Use OTP "${MOCK_VALID_OTP}" to verify.`,
    );
  }

  async verifyOtp(email: string, otp: string): Promise<RawAuthResponse> {
    if (otp !== MOCK_VALID_OTP) {
      throw new GymAuthError();
    }

    // Return fixture with a stable mock user ID derived from the email so
    // the session cookie and Redis key are deterministic per email address.
    return {
      ...AUTH_FIXTURE,
      user_id: `mock-user-${Buffer.from(email).toString("base64url")}`,
    };
  }

  async getSchedule(_token: string): Promise<RawScheduleResponse> {
    return SCHEDULE_FIXTURE;
  }
}
