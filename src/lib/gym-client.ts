/**
 * @file src/lib/gym-client.ts
 * @spec SPEC-002 – Auth & Token Management
 *
 * Defines the `IGymClient` interface and provides the live HTTP implementation
 * (`LiveGymClient`) that proxies requests to the third-party gym API.
 *
 * CRITICAL: This module is server-only. Bearer tokens must never reach the
 * browser. Call `getGymClient()` from API routes only.
 */

import {
  RawAuthResponseSchema,
  type RawAuthResponse,
  type RawScheduleResponse,
  RawScheduleResponseSchema,
  ValidationError,
} from "@/types/gym";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over the gym API.
 * Both the live HTTP client and the fixture-backed mock implement this.
 */
export interface IGymClient {
  /**
   * Triggers an OTP email to the provided address.
   * Maps to `POST ${GYM_API_BASE_URL}/member/login/request-otp?email=…`
   */
  requestOtp(email: string): Promise<void>;

  /**
   * Submits an OTP to exchange for an access token.
   * Maps to `POST ${GYM_API_BASE_URL}/member/login/verify-otp?email=…&otp=…`
   *
   * @throws {GymAuthError} on 401 (invalid OTP)
   * @throws {GymUnavailableError} on timeout / 5xx
   * @throws {ValidationError} when the response payload fails schema validation
   */
  verifyOtp(email: string, otp: string): Promise<RawAuthResponse>;

  /**
   * Fetches the gym schedule by tier.
   *
   * Calls `/member/schedules/by-tier` twice in parallel — once for `NORMAL`
   * and once for `SKILL` — then merges the results into a single array.
   *
   * @param token Gym Bearer token retrieved from Redis
   */
  getSchedule(token: string): Promise<RawScheduleResponse>;
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/** Thrown when the gym API rejects the OTP (HTTP 401). */
export class GymAuthError extends Error {
  constructor() {
    super("Invalid OTP");
    this.name = "GymAuthError";
  }
}

/** Thrown when the gym API is unreachable or returns 5xx / times out. */
export class GymUnavailableError extends Error {
  constructor(cause?: string) {
    super(`Gym service unavailable${cause ? `: ${cause}` : ""}`);
    this.name = "GymUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Live HTTP client
// ---------------------------------------------------------------------------

/**
 * Production gym API client.
 * Forwards requests to `process.env.GYM_API_BASE_URL` and validates all
 * responses with the Zod schemas defined in `src/types/gym.ts`.
 */
export class LiveGymClient implements IGymClient {
  private readonly baseUrl: string;

  constructor() {
    const base = process.env.GYM_API_BASE_URL;
    if (!base) {
      throw new Error(
        "GYM_API_BASE_URL is not set in environment variables.",
      );
    }
    this.baseUrl = base;
  }

  async requestOtp(email: string): Promise<void> {
    const url = `${this.baseUrl}/auth/request-otp?email=${encodeURIComponent(email)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(10_000), // 10 s hard timeout
      });
    } catch (err) {
      throw new GymUnavailableError(
        err instanceof Error ? err.message : "fetch failed",
      );
    }

    if (response.status >= 500 || response.status === 504) {
      throw new GymUnavailableError(`HTTP ${response.status}`);
    }

    // 2xx or 4xx non-auth errors — the gym API returns 200 even for unknown
    // emails in most implementations, so we don't treat 4xx as fatal here.
  }

  async verifyOtp(email: string, otp: string): Promise<RawAuthResponse> {
    const url =
      `${this.baseUrl}/auth/verify-otp` +
      `?email=${encodeURIComponent(email)}&otp=${encodeURIComponent(otp)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new GymUnavailableError(
        err instanceof Error ? err.message : "fetch failed",
      );
    }

    if (response.status === 401) {
      throw new GymAuthError();
    }

    if (response.status >= 500 || response.status === 504) {
      throw new GymUnavailableError(`HTTP ${response.status}`);
    }

    const raw: unknown = await response.json();
    const result = RawAuthResponseSchema.safeParse(raw);

    if (!result.success) {
      throw new ValidationError(
        "gym verify-otp response failed schema validation",
        result.error.issues,
      );
    }

    return result.data;
  }

  async getSchedule(token: string): Promise<RawScheduleResponse> {
    const headers = { Authorization: `Bearer ${token}` };
    const signal = AbortSignal.timeout(10_000);
    const byTierUrl = (tier: string) =>
      `${this.baseUrl}/member/schedules/by-tier?tier=${encodeURIComponent(tier)}`;

    // Fire both tier requests in parallel.
    let normalRes: Response;
    let skillRes: Response;
    try {
      [normalRes, skillRes] = await Promise.all([
        fetch(byTierUrl("NORMAL"), { method: "GET", headers, signal }),
        fetch(byTierUrl("SKILL"), { method: "GET", headers, signal }),
      ]);
    } catch (err) {
      throw new GymUnavailableError(
        err instanceof Error ? err.message : "fetch failed",
      );
    }

    for (const res of [normalRes, skillRes]) {
      if (res.status >= 500 || res.status === 504) {
        throw new GymUnavailableError(`HTTP ${res.status}`);
      }
    }

    const [normalRaw, skillRaw]: [unknown, unknown] = await Promise.all([
      normalRes.json(),
      skillRes.json(),
    ]);

    // Validate and merge both tier arrays.
    const merged: RawScheduleResponse = [];
    for (const [label, raw] of [
      ["NORMAL", normalRaw],
      ["SKILL", skillRaw],
    ] as const) {
      const result = RawScheduleResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new ValidationError(
          `gym schedules/by-tier?tier=${label} response failed schema validation`,
          result.error.issues,
        );
      }
      merged.push(...result.data);
    }

    return merged;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns the appropriate `IGymClient` implementation based on the runtime
 * environment:
 *
 * - `GYM_USE_MOCK=true`  → `MockGymClient` (fixture-backed, no credentials needed)
 * - otherwise            → `LiveGymClient` (real HTTP calls to gym API)
 *
 * Import this function in API routes — do NOT instantiate clients directly.
 */
export async function getGymClient(): Promise<IGymClient> {
  if (process.env.GYM_USE_MOCK === "true") {
    // Dynamically import to keep the mock out of the production bundle.
    const { MockGymClient } = await import("@/lib/gym-client-mock");
    return new MockGymClient();
  }

  return new LiveGymClient();
}
