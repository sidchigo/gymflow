import { describe, it, expect, vi } from "vitest";
import { handleTelegramIncomingMessage, formatDailyPlanTelegram, formatWeeklyPlanTelegram } from "@/lib/telegram-service";
import { type DailyWorkoutPlan, type WeeklyWorkoutPlan } from "@/types/agent";

describe("Telegram Coach Bot Service", () => {
  const sampleDayPlan: DailyWorkoutPlan = {
    date: "2026-08-24",
    day: "Monday",
    focus: "Kickboxing & Heavy Bag S&C",
    modality: "KICKBOXING",
    isGymClass: true,
    gymSlotId: "slot_1",
    plannedTime: "19:00",
    estimatedDurationMinutes: 60,
    exercises: [
      {
        name: "Dynamic Multi-Planar Warmup",
        sets: 1,
        reps: "8 min",
        targetWeight: null,
        unit: "KG",
        weightKg: null,
        weightLbs: null,
        targetRpe: 6,
        restSeconds: 60,
        supersetGroupId: null,
        orderInGroup: null,
        progressionNote: "Joint mobility prep",
      },
    ],
    nutritionAdvice: "Pre-workout carbs 90m prior.",
  };

  it("formats daily plan into clean Telegram markdown", () => {
    const formatted = formatDailyPlanTelegram(sampleDayPlan, true, 45);
    expect(formatted).toContain("MONDAY");
    expect(formatted).toContain("Kickboxing");
    expect(formatted).toContain("45m commute buffer");
    expect(formatted).toContain("Dynamic Multi-Planar Warmup");
  });

  it("formats 7-day weekly schedule summary", () => {
    const weeklyPlan: WeeklyWorkoutPlan = {
      plan: [sampleDayPlan],
      reasoning: "Periodization reasoning",
      updatedAt: "2026-08-24T06:00:00+05:30",
    };
    const formatted = formatWeeklyPlanTelegram(weeklyPlan);
    expect(formatted).toContain("7-DAY ATHLETIC PERIODIZATION PLAN");
    expect(formatted).toContain("Monday");
  });

  it("handles incoming /start command without throwing", async () => {
    // Mock global fetch for telegram sendMessage
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    });

    const res = await handleTelegramIncomingMessage({
      message: {
        chat: { id: 99999 },
        text: "/start",
        from: { first_name: "Athlete" },
      },
    });

    expect(res).toBe("Sent start message");
  });

  it("handles incoming /plan command", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    });

    const res = await handleTelegramIncomingMessage({
      message: {
        chat: { id: 99999 },
        text: "/plan",
        from: { first_name: "Athlete" },
      },
    });

    expect(res).toBe("Sent weekly plan");
  });

  it("handles incoming /today command", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    });

    const res = await handleTelegramIncomingMessage({
      message: {
        chat: { id: 99999 },
        text: "/today",
        from: { first_name: "Athlete" },
      },
    });

    expect(res).toBe("Sent today plan");
  });
});
