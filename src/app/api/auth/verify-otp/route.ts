/**
 * @file src/app/api/auth/verify-otp/route.ts
 * @spec SPEC-002 §4 Steps 3–6 – verify OTP, store token, issue cookie
 *
 * POST /api/auth/verify-otp
 *
 * Body: { email: string, otp: string }
 *
 * 1. Validates the request body.
 * 2. Calls the gym API to verify the OTP and obtain an access token.
 * 3. Stores the gym Bearer token in Upstash Redis (TTL = 82 800 s).
 * 4. Signs an internal JWT containing { userId, role }.
 * 5. Sets an HttpOnly, Secure, SameSite=Lax session cookie on the response.
 * 6. Returns { ok: true } — the Bearer token is NEVER included in the body.
 */

import { NextResponse, type NextRequest } from "next/server";
import { VerifyOtpInputSchema, toAuthSession, type RawAuthResponse } from "@/types/gym";
import { getGymClient, GymAuthError, GymUnavailableError } from "@/lib/gym-client";
import { storeGymToken } from "@/lib/redis";
import { setSessionCookie } from "@/lib/session";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Parse & validate request body ──────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = VerifyOtpInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { email, otp } = parsed.data;

  // ── 2. Verify OTP with gym API ─────────────────────────────────────────────
  let rawAuth: RawAuthResponse;

  try {
    const client = await getGymClient();
    rawAuth = await client.verifyOtp(email, otp);
  } catch (err) {
    if (err instanceof GymAuthError) {
      return NextResponse.json({ error: "INVALID_OTP" }, { status: 401 });
    }
    if (err instanceof GymUnavailableError) {
      return NextResponse.json(
        { error: "GYM_SERVICE_UNAVAILABLE" },
        { status: 502 },
      );
    }
    console.error("[verify-otp] Unexpected error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }

  // ── 3. Transform raw response to internal session (drops passkey fields) ───
  const session = toAuthSession(rawAuth);

  // ── 4. Persist gym Bearer token in Redis (server-side only) ───────────────
  try {
    await storeGymToken(session.userId, session.accessToken);
  } catch (err) {
    // If we can't reach Redis in mock mode, skip gracefully (no token to store).
    if (process.env.GYM_USE_MOCK !== "true") {
      console.error("[verify-otp] Redis write failed:", err);
      return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
    }
    console.warn("[verify-otp] Redis unavailable (mock mode) — skipping token store.");
  }

  // ── 5. Issue session cookie ────────────────────────────────────────────────
  const response = NextResponse.json({ ok: true }, { status: 200 });

  await setSessionCookie(response, {
    userId: session.userId,
    role: session.role,
  });

  // ── 6. Return – Bearer token is NOT in the response body ──────────────────
  return response;
}
