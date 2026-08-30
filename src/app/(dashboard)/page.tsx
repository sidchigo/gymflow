import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getAthleteState, getWeeklyWorkoutPlan } from "@/lib/redis";
import { getOrSyncWeeklySchedule } from "@/lib/schedule-service";
import { weekKey } from "@/lib/schedule-service";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  // 1. Authenticate user from HttpOnly cookie
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("gymflow_session")?.value;
  let session = null;

  if (sessionToken) {
    try {
      session = await verifySessionToken(sessionToken);
    } catch {
      // Token invalid / expired, leave session null
    }
  }

  if (!session) {
    redirect("/login");
  }

  const { userId } = session;

  // 2. Fetch and verify athlete profile
  const athleteState = await getAthleteState(userId);
  if (!athleteState) {
    redirect("/settings?forceSetup=true");
  }

  // 3. Fetch weekly timetable schedule
  let scheduleStore = { slots: [], diffs: [], lastFetchedAt: new Date().toISOString() };
  try {
    const syncResult = await getOrSyncWeeklySchedule(userId);
    scheduleStore = {
      slots: syncResult.store.slots as any,
      diffs: syncResult.store.diffs as any,
      lastFetchedAt: syncResult.store.lastFetchedAt,
    };
  } catch (err) {
    console.error(`[dashboard] Failed to sync timetable for userId=${userId}:`, err);
  }

  // 4. Fetch current weekly workout plan
  const now = new Date();
  const isoWeekId = weekKey(now);
  const weeklyPlan = await getWeeklyWorkoutPlan(userId, isoWeekId);

  // 5. Render client dashboard
  return (
    <DashboardClient
      initialSchedule={scheduleStore}
      initialPlan={weeklyPlan}
      initialConfigured={true}
    />
  );
}

