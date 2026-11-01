import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getAthleteState, getWeeklyWorkoutPlan, saveWeeklyWorkoutPlan } from "@/lib/redis";
import { getOrSyncWeeklySchedule, nowISTDateTime, weekKey } from "@/lib/schedule-service";
import { getPlanningWeekKey, generateDeterministicWeekPlan } from "@/lib/deterministic-planner";
import { isDemoMode } from "@/lib/adapters";
import DashboardClient from "./dashboard-client";

interface PageProps {
  searchParams: Promise<{ week?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const targetWeek = params.week;

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

  if (!session && isDemoMode()) {
    session = { userId: "demo-athlete", role: "MEMBER" };
  } else if (!session) {
    redirect("/login");
  }

  const { userId } = session;

  // 2. Fetch and verify athlete profile
  const athleteState = await getAthleteState(userId);
  if (!athleteState) {
    redirect("/settings?forceSetup=true");
  }

  // 3. Resolve active planning week (IST Monday-Sunday anchor with Sunday rollover)
  const currentDateIST = nowISTDateTime();
  const isoWeekId = targetWeek || getPlanningWeekKey(currentDateIST);

  // 4. Fetch weekly timetable schedule
  let scheduleStore = { slots: [], diffs: [], lastFetchedAt: new Date().toISOString() };
  try {
    const syncResult = await getOrSyncWeeklySchedule(userId, { targetWeekId: isoWeekId });
    scheduleStore = {
      slots: syncResult.store.slots as any,
      diffs: syncResult.store.diffs as any,
      lastFetchedAt: syncResult.store.lastFetchedAt,
    };
  } catch (err) {
    console.error(`[dashboard] Failed to sync timetable for userId=${userId}:`, err);
  }

  // 5. Fetch current weekly workout plan
  let weeklyPlan = await getWeeklyWorkoutPlan(userId, isoWeekId);
  if (!weeklyPlan) {
    const currentIsoWeek = weekKey(new Date());
    if (currentIsoWeek !== isoWeekId) {
      weeklyPlan = await getWeeklyWorkoutPlan(userId, currentIsoWeek);
    }
  }

  if (!weeklyPlan) {
    weeklyPlan = generateDeterministicWeekPlan({
      athleteState,
      weeklyGymStoreSlots: scheduleStore.slots,
      currentDateIST,
    });
    await saveWeeklyWorkoutPlan(userId, isoWeekId, weeklyPlan);
  }

  // 6. Render client dashboard
  return (
    <DashboardClient
      initialSchedule={scheduleStore}
      initialPlan={weeklyPlan}
      initialConfigured={true}
      activeWeek={isoWeekId}
      athleteState={athleteState}
    />
  );
}

