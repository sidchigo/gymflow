/**
 * @file src/app/api/auth/demo/route.ts
 * @description Instant 1-click recruiter sandbox authentication for public demo mode.
 */

import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json(
    { ok: true, userId: "demo-athlete", mode: "demo" },
    { status: 200 }
  );

  await setSessionCookie(response, {
    userId: "demo-athlete",
    role: "MEMBER",
  });

  return response;
}

