import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getWeeklyWorkoutPlan } from "@/lib/redis";
import { weekKey } from "@/lib/schedule-service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const now = new Date();
  const isoWeekId = weekKey(now);
  const plan = await getWeeklyWorkoutPlan(session.userId, isoWeekId);

  return NextResponse.json({ plan }, { status: 200 });
}
