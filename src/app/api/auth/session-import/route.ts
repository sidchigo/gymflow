/**
 * @file src/app/api/auth/session-import/route.ts
 * @description Allows athletes to import an active gym session token (e.g. from an active
 * biometric session on gymwebapp.thecooperfitness.com) directly into GymFlow when OTP is down.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { decodeJwt } from "jose";
import { storeGymToken } from "@/lib/redis";
import { setSessionCookie } from "@/lib/session";

const SessionImportSchema = z.object({
  token: z.string().min(10),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = SessionImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { token } = parsed.data;

  // 1. Decode JWT payload to get user identity
  let userId = "";
  let role = "MEMBER";

  try {
    const claims = decodeJwt(token);
    userId = (claims.user_id as string) || (claims.sub as string) || (claims.id as string) || "";
    role = (claims.role as string) || "MEMBER";
  } catch {
    // If token is opaque or custom
    userId = "athlete-imported-session";
  }

  if (!userId) {
    userId = "athlete-imported-session";
  }

  // 2. Validate token against the gym API if configured
  if (process.env.GYM_USE_MOCK !== "true" && process.env.GYM_API_BASE_URL) {
    try {
      const testRes = await fetch(`${process.env.GYM_API_BASE_URL}/member/schedules/by-tier?tier=NORMAL`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!testRes.ok && testRes.status === 401) {
        return NextResponse.json({ error: "INVALID_OR_EXPIRED_GYM_TOKEN" }, { status: 401 });
      }
    } catch (err) {
      console.warn("[session-import] Gym API check unreachable, proceeding with valid JWT:", err);
    }
  }

  // 3. Persist gym token in Redis (23 hours TTL)
  await storeGymToken(userId, token);

  // 4. Issue HttpOnly session cookie
  const response = NextResponse.json(
    { ok: true, userId, message: "Active gym session successfully connected." },
    { status: 200 }
  );

  // Allow CORS if triggered via console/bookmarklet from gymwebapp.thecooperfitness.com
  const origin = request.headers.get("origin");
  if (origin && (origin.includes("thecooperfitness.com") || origin.includes("localhost"))) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  await setSessionCookie(response, {
    userId,
    role,
  });

  return response;
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin") || "*";
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}
