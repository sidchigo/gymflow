"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import WeekStrip from "@/components/mobile/week-strip";
import DayCardView from "@/components/mobile/day-card-view";
import ScheduleDiffAlert from "@/components/mobile/schedule-diff-alert";

import { type WeeklyScheduleStore } from "@/types/gym";
import { type WeeklyWorkoutPlan, type AthleteState } from "@/types/agent";

interface DashboardClientProps {
  initialSchedule: WeeklyScheduleStore;
  initialPlan: WeeklyWorkoutPlan | null;
  initialConfigured: boolean;
  activeWeek?: string;
  athleteState: AthleteState;
}

// Helper to compute Monday of an ISO week
function getMondayOfISOWeek(year: number, week: number): Date {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    ISOweekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  return ISOweekStart;
}

function diffStorageKey(weekNumber: string): string {
  return `gymflow:dismissed-diff:${weekNumber}`;
}

function readDismissedDiff(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // localStorage may be unavailable (SSR, private mode)
    return null;
  }
}

function writeDismissedDiff(key: string, detectedAt: string | null) {
  try {
    if (detectedAt) {
      window.localStorage.setItem(key, detectedAt);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable (SSR, private mode)
  }
}

// Latest detection timestamp across all diffs for display consideration
function latestDiffDetectedAt(diffs: { detectedAt: string }[]): string | null {
  let latest: string | null = null;
  for (const diff of diffs) {
    if (!latest || diff.detectedAt > latest) latest = diff.detectedAt;
  }
  return latest;
}

interface DayPillResult {
  dayAbbrev: string;
  dateNum: number;
  fullDate: string;
  dotStatus: string;
}

function autoSelectDate(weekDays: DayPillResult[]): string {
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = weekDays.find((d) => d.fullDate === todayIST);
  if (today) return today.fullDate;
  return weekDays[0]?.fullDate ?? "";
}

export default function DashboardClient({
  initialSchedule,
  initialPlan,
  activeWeek,
  athleteState,
}: DashboardClientProps) {
  const router = useRouter();
  const [schedule] = useState<WeeklyScheduleStore>(initialSchedule);
  const [plan] = useState<WeeklyWorkoutPlan | null>(initialPlan);

  const weekNumber = (() => {
    if (activeWeek) {
      const parts = activeWeek.replace("_", "-").split("-");
      const week = parseInt(parts[1]?.replace("W", "") ?? "", 10);
      if (!isNaN(week)) return String(week);
    }
    return "";
  })();

  const STORAGE_KEY = diffStorageKey(weekNumber);

  // Latest change timestamp across the diff log (resets per week via weekData timestamp)
  const latestDetectedAt = latestDiffDetectedAt(schedule.diffs);

  // Store which diff we've already acknowledged, so a NEW reschedule/cancel re-surfaces.
  const [dismissedState, setDismissedState] = useState<{
    week: string;
    dismissedAt: string | null;
  }>(() => ({
    week: weekNumber,
    dismissedAt: readDismissedDiff(STORAGE_KEY),
  }));

  // Adjust state during render when the active week changes (supported React pattern)
  if (dismissedState.week !== weekNumber) {
    setDismissedState({
      week: weekNumber,
      dismissedAt: readDismissedDiff(diffStorageKey(weekNumber)),
    });
  }

  const dismissedAt = dismissedState.dismissedAt;
  const setDismissedDiffs = () =>
    setDismissedState({ week: weekNumber, dismissedAt: latestDetectedAt });

  // Banner shows when there are diffs AND the latest change is newer than what we dismissed
  const showDiffAlert = !!(schedule.diffs.length > 0 && (!dismissedAt || (latestDetectedAt && latestDetectedAt > dismissedAt)));

  // Persist the dismissed timestamp for the current week whenever it changes
  useEffect(() => {
    writeDismissedDiff(STORAGE_KEY, dismissedAt);
  }, [dismissedAt, weekNumber, STORAGE_KEY]);

  // Derive target Monday based on activeWeek prop (e.g. "2026_W35" or "2026-W35")
  const mondayDate = useMemo(() => {
    if (activeWeek) {
      const parts = activeWeek.replace("_", "-").split("-");
      const year = parseInt(parts[0] ?? "", 10);
      const week = parseInt(parts[1]?.replace("W", "") ?? "", 10);
      if (!isNaN(year) && !isNaN(week)) {
        return getMondayOfISOWeek(year, week);
      }
    }
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + distanceToMonday);
    return monday;
  }, [activeWeek]);

  // Compute 7 days of active week (Mon → Sun)
  const weekDays = useMemo(() => {
    const dates = [];
    const dayAbbrevs = ["M", "T", "W", "T", "F", "S", "S"];

    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(mondayDate.getDate() + i);
      const dateStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

      let dotStatus: "combat" | "strength" | "rest" | "cancelled" = "rest";

      const dayDiffs = schedule.diffs.filter((diff) => diff.date === dateStr);
      const hasCancelled = dayDiffs.some((diff) => diff.type === "CANCELLED");

      if (hasCancelled) {
        dotStatus = "cancelled";
      } else {
        const dayWorkout = plan?.plan.find((p) => p.date === dateStr);
        if (dayWorkout) {
          if (dayWorkout.modality === "BJJ" || dayWorkout.modality === "KICKBOXING") {
            dotStatus = "combat";
          } else if (
            dayWorkout.modality === "REST" ||
            dayWorkout.modality === "MOBILITY_RECOVERY"
          ) {
            dotStatus = "rest";
          } else {
            dotStatus = "strength";
          }
        }
      }

      dates.push({
        dayAbbrev: dayAbbrevs[i] ?? "",
        dateNum: d.getDate(),
        fullDate: dateStr,
        dotStatus,
      });
    }
    return dates;
  }, [mondayDate, schedule, plan]);

  // Selected day: defaults to today (if in the active week) else the week's Monday.
  // Derived via render-adjustment so it resets whenever the active week changes.
  const [selectedDateState, setSelectedDateState] = useState<{
    week: string;
    date: string;
  }>(() => ({
    week: activeWeek ?? "",
    date: autoSelectDate(weekDays),
  }));

  if (selectedDateState.week !== (activeWeek ?? "")) {
    setSelectedDateState({ week: activeWeek ?? "", date: autoSelectDate(weekDays) });
  }

  const selectedDate = selectedDateState.date;
  const setSelectedDate = (date: string) =>
    setSelectedDateState({ week: activeWeek ?? "", date });

  const handlePrevWeek = () => {
    if (activeWeek) {
      const parts = activeWeek.replace("_", "-").split("-");
      const year = parseInt(parts[0] ?? "", 10);
      const week = parseInt(parts[1]?.replace("W", "") ?? "", 10);
      if (!isNaN(year) && !isNaN(week)) {
        let prevWeek = week - 1;
        let prevYear = year;
        if (prevWeek < 1) {
          prevWeek = 52;
          prevYear -= 1;
        }
        const prevWeekStr = `${prevYear}_W${String(prevWeek).padStart(2, "0")}`;
        router.replace(`/?week=${prevWeekStr}`, { scroll: false });
      }
    }
  };

  const handleNextWeek = () => {
    if (activeWeek) {
      const parts = activeWeek.replace("_", "-").split("-");
      const year = parseInt(parts[0] ?? "", 10);
      const week = parseInt(parts[1]?.replace("W", "") ?? "", 10);
      if (!isNaN(year) && !isNaN(week)) {
        let nextWeek = week + 1;
        let nextYear = year;
        if (nextWeek > 52) {
          nextWeek = 1;
          nextYear += 1;
        }
        const nextWeekStr = `${nextYear}_W${String(nextWeek).padStart(2, "0")}`;
        router.replace(`/?week=${nextWeekStr}`, { scroll: false });
      }
    }
  };

  const activeDayWorkout = plan?.plan.find((p) => p.date === selectedDate) ?? null;

  const handleNavigateToCoach = () => {
    setDismissedDiffs();
    router.push(
      "/coach?prompt=Sync%20and%20update%20my%20schedule%20with%20the%20new%20gym%20timetable"
    );
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 px-4 pt-4 pb-28 flex flex-col gap-4 max-w-xl lg:max-w-4xl mx-auto w-full lg:px-6 lg:py-6 lg:pb-6">
        {showDiffAlert && (
          <ScheduleDiffAlert
            diffCount={schedule.diffs.length}
            weekNumber={weekNumber}
            onNavigateToCoach={handleNavigateToCoach}
            onDismiss={() => setDismissedDiffs()}
          />
        )}
        <WeekStrip
          days={weekDays}
          selectedDate={selectedDate}
          onSelectDay={(date) => setSelectedDate(date)}
          activeWeek={activeWeek}
          onPrevWeek={handlePrevWeek}
          onNextWeek={handleNextWeek}
        />
        <DayCardView plan={activeDayWorkout} athleteState={athleteState} />
      </div>
    </div>
  );
}
