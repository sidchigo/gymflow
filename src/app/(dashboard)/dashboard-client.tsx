"use client";

import { useState, useEffect } from "react";
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

export default function DashboardClient({
  initialSchedule,
  initialPlan,
  activeWeek,
  athleteState,
}: DashboardClientProps) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [schedule] = useState<WeeklyScheduleStore>(initialSchedule);
  const [plan] = useState<WeeklyWorkoutPlan | null>(initialPlan);

  const [dismissedDiffs, setDismissedDiffs] = useState(false);

  // Derive target Monday based on activeWeek prop (e.g. "2026_W35" or "2026-W35")
  const mondayDate = (() => {
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
  })();

  // Set initial selected date to active week's Monday or today if it's the active week
  useEffect(() => {
    const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const isTodayInActiveWeek = weekDays.some((d) => d.fullDate === todayIST);
    if (isTodayInActiveWeek) {
      setSelectedDate(todayIST);
    } else if (weekDays.length > 0 && weekDays[0]) {
      setSelectedDate(weekDays[0].fullDate);
    }
  }, [activeWeek]);

  // Compute 7 days of active week (Mon → Sun)
  const weekDays = (() => {
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
  })();

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
        router.push(`/?week=${prevWeekStr}`);
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
        router.push(`/?week=${nextWeekStr}`);
      }
    }
  };

  const activeDayWorkout = plan?.plan.find((p) => p.date === selectedDate) ?? null;

  const weekNumber = (() => {
    if (activeWeek) {
      const parts = activeWeek.replace("_", "-").split("-");
      const week = parseInt(parts[1]?.replace("W", "") ?? "", 10);
      if (!isNaN(week)) return String(week);
    }
    return "";
  })();

  const handleNavigateToCoach = () => {
    setDismissedDiffs(true);
    router.push(
      "/coach?prompt=Sync%20and%20update%20my%20schedule%20with%20the%20new%20gym%20timetable"
    );
  };



  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 px-4 pt-4 pb-28 flex flex-col gap-4 max-w-xl lg:max-w-4xl mx-auto w-full lg:px-6 lg:py-6 lg:pb-6">
        {!dismissedDiffs && schedule.diffs.length > 0 && (
          <ScheduleDiffAlert
            diffCount={schedule.diffs.length}
            weekNumber={weekNumber}
            onNavigateToCoach={handleNavigateToCoach}
            onDismiss={() => setDismissedDiffs(true)}
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
