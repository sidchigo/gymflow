import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getWeeklyWorkoutPlan } from "@/lib/redis";
import { weekKey } from "@/lib/schedule-service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get("week");

  const now = new Date();
  const isoWeekId = weekParam || weekKey(now);
  const plan = await getWeeklyWorkoutPlan(session.userId, isoWeekId);

  return NextResponse.json({ plan }, { status: 200 });
}
