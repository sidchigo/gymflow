"use client";

import { useState, useEffect } from "react";
import HeaderBar from "@/components/mobile/header-bar";
import WeekStrip from "@/components/mobile/week-strip";
import DayCardView from "@/components/mobile/day-card-view";
import DiffToast from "@/components/mobile/diff-toast";
import CoachSheet, { CoachSidebarPanel } from "@/components/chat/coach-sheet";
import ProfileSettingsDialog from "@/components/settings/profile-settings-dialog";
import { type ChatMessage } from "@/components/chat/message-stream";
import { type WeeklyScheduleStore } from "@/types/gym";
import { type WeeklyWorkoutPlan, type AthleteState, type AthleteProfile } from "@/types/agent";
import { Home, Settings2, Sparkles } from "lucide-react";

interface DashboardClientProps {
  initialSchedule: WeeklyScheduleStore;
  initialPlan: WeeklyWorkoutPlan | null;
  initialAthleteState: AthleteState;
  initialConfigured: boolean;
}



export default function DashboardClient({
  initialSchedule,
  initialPlan,
  initialAthleteState,
  initialConfigured,
}: DashboardClientProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [schedule, setSchedule] = useState<WeeklyScheduleStore>(initialSchedule);
  const [plan, setPlan] = useState<WeeklyWorkoutPlan | null>(initialPlan);
  const [athleteState, setAthleteState] = useState<AthleteState>(initialAthleteState);
  const [isConfigured, setIsConfigured] = useState(initialConfigured);
  const [settingsOpen, setSettingsOpen] = useState(!initialConfigured);
  const [syncing, setSyncing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [executingTool, setExecutingTool] = useState<string | null>(null);
  const [dismissedDiffs, setDismissedDiffs] = useState(false);

  // Set initial selected date to current date in IST
  useEffect(() => {
    const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    setSelectedDate(todayIST);
  }, []);



  // Compute 7 days of current week (Mon → Sun)
  const weekDays = (() => {
    const dates = [];
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + distanceToMonday);

    const dayAbbrevs = ["M", "T", "W", "T", "F", "S", "S"];

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
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

  const activeDayWorkout = plan?.plan.find((p) => p.date === selectedDate) ?? null;





  const handleSyncTimetable = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/schedule/sync?forceRefresh=true");
      if (res.ok) {
        const data = await res.json();
        setSchedule({
          slots: data.slots ?? [],
          diffs: data.diffs ?? [],
          lastFetchedAt: data.lastFetchedAt,
        });
        setDismissedDiffs(false);
      }
    } catch (err) {
      console.error("Failed to sync timetable:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    const userMsgId = Math.random().toString();
    setMessages((prev) => [...prev, { id: userMsgId, sender: "user", text }]);

    const agentMsgId = Math.random().toString();
    setMessages((prev) => [...prev, { id: agentMsgId, sender: "coach", text: "" }]);

    const historyPayload = messages.map((m) => ({
      role: m.sender === "user" ? ("user" as const) : ("model" as const),
      parts: [{ text: m.text }],
    }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyPayload }),
      });

      if (!response.body) throw new Error("No response stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "text" && event.text) {
              accumulatedText += event.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId ? { ...m, text: accumulatedText } : m
                )
              );
            } else if (event.type === "tool_start") {
              setExecutingTool(event.name);
            } else if (event.type === "tool_end") {
              setExecutingTool(null);
              if (event.name === "replan_week_schedule") {
                const planRes = await fetch("/api/schedule/plan");
                if (planRes.ok) {
                  const planData = await planRes.json();
                  if (planData.plan) setPlan(planData.plan);
                }
              }
            }
          } catch (e) {
            console.error("Failed to parse NDJSON token stream:", e);
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Stream reader failed:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, text: m.text + `\n\n[Coach communication interrupted: ${message}]` }
            : m
        )
      );
    } finally {
      setExecutingTool(null);
    }
  };

  const handleSaveSuccess = (updatedProfile: AthleteProfile) => {
    setAthleteState((prev) => ({ ...prev, profile: updatedProfile }));
    setIsConfigured(true);
  };

  const coachProps = {
    messages,
    executingTool,
    onSendMessage: handleSendMessage,
    disabled: !!executingTool || !isConfigured,
  };

  return (
    <div className="flex-1 flex flex-col">
      {/**
       * ─── RESPONSIVE CONTENT GRID ──────────────────────────────────────────
       *
       * Mobile  (< lg):  Single column, max-w-lg centered, stacked flex column
       * Desktop (≥ lg):  12-col grid — left 7 cols workout deck, right 5 cols
       *                  sticky AI copilot pane
       */}
      <div
        className={[
          "flex-1",
          // Mobile: centered narrow column
          "px-4 pt-4 pb-28",
          "flex flex-col gap-4",
          // Desktop: wide grid
          "lg:max-w-7xl lg:mx-auto lg:w-full lg:px-6 lg:py-6",
          "lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start lg:pb-6",
        ].join(" ")}
      >
        {/* ─── Left Column: Telemetry + Week + Workout Deck ──────────── */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-4 min-w-0">
          {/* Header card */}
          <HeaderBar
            onSync={handleSyncTimetable}
            syncing={syncing}
          />

          {/* Diff alert (inline, not full-width sticky) */}
          {!dismissedDiffs && schedule.diffs.length > 0 && (
            <DiffToast
              diffs={schedule.diffs}
              onDismiss={() => setDismissedDiffs(true)}
            />
          )}

          {/* Week strip */}
          <WeekStrip
            days={weekDays}
            selectedDate={selectedDate}
            onSelectDay={(date) => setSelectedDate(date)}
          />

          {/* Day workout deck */}
          <DayCardView plan={activeDayWorkout} />
        </div>

        {/* ─── Right Column: Permanent AI Coach Sidebar (desktop only) ── */}
        <div className="hidden lg:block lg:col-span-5 xl:col-span-4 lg:sticky lg:top-6">
          <CoachSidebarPanel {...coachProps} />
        </div>
      </div>

      {/* ─── Mobile: Floating bottom sheet trigger + drawer ────────────── */}
      <div className="lg:hidden">
        {/* Floating Bottom Navigation Row — matches mockup layout structure */}
        <div className="fixed bottom-6 left-6 right-6 max-w-lg mx-auto z-40 flex items-center gap-4">
          {/* Glassmorphic Capsule Navbar (Home & Settings only) */}
          <div className="flex-1 h-13 bg-[#0d111d]/75 backdrop-blur-xl border border-zinc-800/60 rounded-full flex items-center justify-around px-6 shadow-2xl">
            {/* Home */}
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="text-violet-400 active:scale-95 transition-all outline-none p-2.5"
            >
              <Home size={18} strokeWidth={2.5} />
            </button>

            {/* Settings */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-zinc-400 hover:text-zinc-200 active:scale-95 transition-all outline-none p-2.5"
            >
              <Settings2 size={18} strokeWidth={2.5} />
            </button>
          </div>

          {/* Standalone Circular FAB on the right (AI Coach Chat) */}
          <button
            onClick={() => setChatOpen(true)}
            className="h-13 w-13 bg-violet-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-violet-600/35 hover:bg-violet-500 active:scale-90 transition-all outline-none shrink-0"
          >
            <Sparkles size={16} strokeWidth={2.5} />
          </button>
        </div>

        <CoachSheet
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          {...coachProps}
        />
      </div>

      {/* ─── Profile / Settings Modal ──────────────────────────────────── */}
      <ProfileSettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaveSuccess={handleSaveSuccess}
        initialProfile={athleteState.profile}
        forceSetup={!isConfigured}
      />
    </div>
  );
}
