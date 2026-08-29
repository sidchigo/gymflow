"use client";

import { useState, useEffect } from "react";
import HeaderBar from "@/components/mobile/header-bar";
import WeekStrip from "@/components/mobile/week-strip";
import DayCardView from "@/components/mobile/day-card-view";
import DiffToast from "@/components/mobile/diff-toast";
import CoachSheet from "@/components/chat/coach-sheet";
import ProfileSettingsDialog from "@/components/settings/profile-settings-dialog";
import { type ChatMessage } from "@/components/chat/message-stream";
import { type WeeklyScheduleStore } from "@/types/gym";
import { type WeeklyWorkoutPlan, type AthleteState, type AthleteProfile } from "@/types/agent";

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

  // Compute 7 days of current week
  const weekDays = (() => {
    const dates = [];
    const now = new Date();
    // Get current day of week (0 = Sunday, 1 = Monday...)
    const currentDay = now.getDay();
    // Distance to Monday
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + distanceToMonday);

    const dayAbbrevs = ["M", "T", "W", "T", "F", "S", "S"];

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
      
      // Determine dot status
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
          } else if (dayWorkout.modality === "REST" || dayWorkout.modality === "MOBILITY_RECOVERY") {
            dotStatus = "rest";
          } else {
            dotStatus = "strength";
          }
        }
      }

      dates.push({
        dayAbbrev: dayAbbrevs[i] || "",
        dateNum: d.getDate(),
        fullDate: dateStr,
        dotStatus,
      });
    }
    return dates;
  })();

  const activeDayWorkout = plan?.plan.find((p) => p.date === selectedDate) || null;

  const activeDayName = (weekDays.find((d) => d.fullDate === selectedDate)?.fullDate
    ? new Date(selectedDate).toLocaleDateString("en-US", { weekday: "long" })
    : "Monday") as "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  
  const currentWorkMode = athleteState.profile.weeklyWorkSchedule[
    activeDayName
  ]?.mode || "WFH";

  // Dynamic date header string formatting (e.g. "Sat, 29 Aug")
  const dateHeaderStr = (() => {
    if (!selectedDate) return "...";
    const d = new Date(selectedDate);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC", // Avoid double timezone offset shift
    });
  })();

  const handleSyncTimetable = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/schedule/sync?forceRefresh=true");
      if (res.ok) {
        const data = await res.json();
        setSchedule({
          slots: data.slots || [],
          diffs: data.diffs || [],
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
    const newUserMsg: ChatMessage = { id: userMsgId, sender: "user", text };
    
    // Add user message to local state
    setMessages((prev) => [...prev, newUserMsg]);

    const agentMsgId = Math.random().toString();
    const newAgentMsg: ChatMessage = { id: agentMsgId, sender: "coach", text: "" };
    setMessages((prev) => [...prev, newAgentMsg]);

    // Format context history for API
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
        buffer = lines.pop() || "";

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
              // If coach replanned schedule, trigger instant hot-reload of plan
              if (event.name === "replan_week_schedule") {
                const planRes = await fetch("/api/schedule/plan");
                if (planRes.ok) {
                  const planData = await planRes.json();
                  if (planData.plan) {
                    setPlan(planData.plan);
                  }
                }
              }
            }
          } catch (e) {
            console.error("Failed to parse NDJSON token stream:", e);
          }
        }
      }
    } catch (err: any) {
      console.error("Stream reader failed:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, text: m.text + `\n\n[Coach Communication interrupted: ${err.message}]` }
            : m
        )
      );
    } finally {
      setExecutingTool(null);
    }
  };

  const handleSaveSuccess = (updatedProfile: AthleteProfile) => {
    setAthleteState((prev) => ({
      ...prev,
      profile: updatedProfile,
    }));
    setIsConfigured(true);
  };

  return (
    <div className="flex h-screen w-full flex-col lg:flex-row">
      {/* Primary Dashboard Container */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <HeaderBar
          currentDateStr={dateHeaderStr}
          weightKg={athleteState.profile.weightKg}
          workMode={currentWorkMode}
          onSync={handleSyncTimetable}
          syncing={syncing}
          onSettingsOpen={() => setSettingsOpen(true)}
        />

        {/* Schedule Diff Alerts Toast */}
        {!dismissedDiffs && schedule.diffs.length > 0 && (
          <DiffToast
            diffs={schedule.diffs}
            onDismiss={() => setDismissedDiffs(true)}
          />
        )}

        {/* Swipeable Horizontal Week Strip */}
        <WeekStrip
          days={weekDays}
          selectedDate={selectedDate}
          onSelectDay={(date) => setSelectedDate(date)}
        />

        {/* Scrollable Day View Panel */}
        <DayCardView plan={activeDayWorkout} className="flex-1" />
      </div>

      {/* Slide-Up / Pinned Coach Drawer Chat sheet */}
      <CoachSheet
        isOpen={chatOpen}
        onOpen={() => setChatOpen(true)}
        onClose={() => setChatOpen(false)}
        messages={messages}
        executingTool={executingTool}
        onSendMessage={handleSendMessage}
        disabled={!!executingTool || !isConfigured}
      />

      {/* Settings Configuration Modal */}
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
