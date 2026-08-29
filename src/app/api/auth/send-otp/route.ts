/**
 * @file src/app/api/auth/send-otp/route.ts
 * @spec SPEC-002 §4 Step 1–2 – request OTP
 *
 * POST /api/auth/send-otp
 *
 * Body: { email: string }
 *
 * Forwards the request to the gym API's OTP endpoint.
 * No credentials are returned to the client.
 */

import { NextResponse, type NextRequest } from "next/server";
import { RequestOtpInputSchema } from "@/types/gym";
import { getGymClient, GymUnavailableError } from "@/lib/gym-client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Parse & validate request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = RequestOtpInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { email } = parsed.data;

  // 2. Forward to gym API (or mock).
  try {
    const client = await getGymClient();
    await client.requestOtp(email);
  } catch (err) {
    if (err instanceof GymUnavailableError) {
      return NextResponse.json(
        { error: "GYM_SERVICE_UNAVAILABLE" },
        { status: 502 },
      );
    }
    console.error("[send-otp] Unexpected error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }

  // 3. Return success — the actual OTP is delivered by the gym to the user's
  //    email address. We communicate nothing else to the client.
  return NextResponse.json({ ok: true }, { status: 200 });
}
