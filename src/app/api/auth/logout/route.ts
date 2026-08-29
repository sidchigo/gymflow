import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearSessionCookie(response);
  return response;
}
