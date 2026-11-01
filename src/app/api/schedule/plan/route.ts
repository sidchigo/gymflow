import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  getWeeklyWorkoutPlan,
  saveWeeklyWorkoutPlan,
  getAthleteState,
  saveAthleteState,
} from "@/lib/redis";
import { nowISTDateTime, weekKey } from "@/lib/schedule-service";
import { getPlanningWeekKey } from "@/lib/deterministic-planner";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get("week");

  const currentDateIST = nowISTDateTime();
  const isoWeekId = weekParam || getPlanningWeekKey(currentDateIST);
  let plan = await getWeeklyWorkoutPlan(session.userId, isoWeekId);
  if (!plan && !weekParam) {
    const currentIsoWeek = weekKey(new Date());
    if (currentIsoWeek !== isoWeekId) {
      plan = await getWeeklyWorkoutPlan(session.userId, currentIsoWeek);
    }
  }

  return NextResponse.json({ plan }, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { action, date, week, plan: updatedPlan } = (body || {}) as {
    action?: string;
    date?: string;
    week?: string;
    plan?: any;
  };

  const currentDateIST = nowISTDateTime();
  const isoWeekId = week || getPlanningWeekKey(currentDateIST);

  if (action === "skip_day" && date) {
    // 1. Log athlete event
    let athleteState = await getAthleteState(session.userId);
    if (athleteState) {
      athleteState.events = [
        ...(athleteState.events || []),
        {
          date,
          type: "MISSED_SESSION" as const,
          severity: "MILD" as const,
          notes: "Session skipped by athlete request.",
        },
      ];
      await saveAthleteState(session.userId, athleteState);
    }

    // 2. Auto-regulate plan in memory / store
    let currentPlan = await getWeeklyWorkoutPlan(session.userId, isoWeekId);
    if (currentPlan) {
      currentPlan.plan = currentPlan.plan.map((day) => {
        if (day.date === date) {
          return {
            ...day,
            focus: "Rest/Recovery (Missed Session)",
            modality: "REST",
            isGymClass: false,
            gymSlotId: null,
            exercises: [],
            estimatedDurationMinutes: 0,
          };
        }
        return day;
      });
      await saveWeeklyWorkoutPlan(session.userId, isoWeekId, currentPlan);
      return NextResponse.json({ ok: true, plan: currentPlan }, { status: 200 });
    }
  }

  if (updatedPlan) {
    await saveWeeklyWorkoutPlan(session.userId, isoWeekId, updatedPlan);
    return NextResponse.json({ ok: true, plan: updatedPlan }, { status: 200 });
  }

  return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
}

