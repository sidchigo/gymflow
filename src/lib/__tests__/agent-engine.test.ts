import { vi, describe, it, expect, beforeEach } from "vitest";
import { runCoachAgent } from "@/lib/agent-engine";
import {
  getAthleteState,
  saveAthleteState,
  getWeeklyWorkoutPlan,
} from "@/lib/redis";
import type { LLMProvider } from "@/lib/llm-provider";
import type { AthleteState } from "@/types/agent";

// Mock the Redis database module
vi.mock("@/lib/redis", () => {
  const db = new Map<string, any>();
  return {
    getAthleteState: vi.fn(async (userId: string) => {
      return db.get(`athlete:state:${userId}`) || null;
    }),
    saveAthleteState: vi.fn(async (userId: string, state: any) => {
      db.set(`athlete:state:${userId}`, state);
    }),
    getWeeklyWorkoutPlan: vi.fn(async (userId: string, isoWeekId: string) => {
      return db.get(`plan:${userId}:${isoWeekId}`) || null;
    }),
    saveWeeklyWorkoutPlan: vi.fn(async (userId: string, isoWeekId: string, plan: any) => {
      db.set(`plan:${userId}:${isoWeekId}`, plan);
    }),
    getWeeklyStore: vi.fn(async (_key: string) => {
      return {
        lastFetchedAt: "2026-08-29T10:00:00+05:30",
        slots: [
          {
            id: "slot-1",
            date: "2026-08-31",
            startTime: "07:00",
            endTime: "08:00",
            title: "BJJ",
            trainer: "Coach Dave",
          },
          {
            id: "slot-2",
            date: "2026-09-01",
            startTime: "18:00",
            endTime: "19:00",
            title: "Kickboxing",
            trainer: "Coach Steve",
          },
        ],
        diffs: [],
      };
    }),
    scheduleWeekKey: vi.fn((isoWeekId: string) => `schedule:week:${isoWeekId}`),
  };
});

class MockLLMProvider implements LLMProvider {
  public generateCompletion = vi.fn();
}

describe("Coach Agent Engine", () => {
  const userId = "test-user-1";
  let mockProvider: MockLLMProvider;

  const initialAthleteState: AthleteState = {
    profile: {
      userId,
      weightKg: 80,
      heightCm: 180,
      targetDaysPerWeek: 5,
      weightUnitPreference: "KG",
      mandatoryCombatSessions: { kickboxing: 1, bjj: 1 },
      weeklyWorkSchedule: {
        Monday: { mode: "WFH", commuteMinutesOneWay: 0 },
        Tuesday: { mode: "WFO", commuteMinutesOneWay: 45 },
        Wednesday: { mode: "WFH", commuteMinutesOneWay: 0 },
        Thursday: { mode: "WFO", commuteMinutesOneWay: 45 },
        Friday: { mode: "WFH", commuteMinutesOneWay: 0 },
        Saturday: { mode: "WFH", commuteMinutesOneWay: 0 },
        Sunday: { mode: "WFH", commuteMinutesOneWay: 0 },
      },
      modalities: ["BJJ", "KICKBOXING", "UPPER_HYPERTROPHY", "LOWER_STRENGTH", "REST"],
      dietaryPreference: "BALANCED",
      targetDailyProteinGrams: 160,
    },
    lifts: [],
    events: [],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockProvider = new MockLLMProvider();
    // Reset/seed mock Redis DB
    await saveAthleteState(userId, initialAthleteState);
  });

  it("handles a direct conversational query without calling tools", async () => {
    mockProvider.generateCompletion.mockResolvedValue({
      text: "Hello! Ready to train today? Focus on mobility on your work-from-office days.",
    });

    const result = await runCoachAgent({
      userId,
      userMessage: "Hey Coach, WFO today. What should I do?",
      provider: mockProvider,
    });

    expect(result.text).toBe(
      "Hello! Ready to train today? Focus on mobility on your work-from-office days."
    );
    expect(result.toolCallsExecuted).toHaveLength(0);
    expect(mockProvider.generateCompletion).toHaveBeenCalledTimes(1);

    // Verify model configuration was passed down
    const calls = mockProvider.generateCompletion.mock.calls;
    expect(calls).toHaveLength(1);
    const callArgs = calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.model).toBeUndefined(); // Should default in provider
  });

  it("supports configurable model overrides passed to the orchestrator", async () => {
    mockProvider.generateCompletion.mockResolvedValue({
      text: "Standard response.",
    });

    await runCoachAgent({
      userId,
      userMessage: "Hello",
      provider: mockProvider,
      model: "gemini-2.5-pro",
    });

    const calls = mockProvider.generateCompletion.mock.calls;
    expect(calls).toHaveLength(1);
    const callArgs = calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.model).toBe("gemini-2.5-pro");
  });

  it("executes replan_week_schedule and saves the plan to Redis", async () => {
    // 1st LLM call: requests the replan tool
    mockProvider.generateCompletion.mockResolvedValueOnce({
      toolCalls: [
        {
          name: "replan_week_schedule",
          args: {
            plan: [
              {
                date: "2026-08-31",
                day: "Monday",
                focus: "BJJ",
                modality: "BJJ",
                isGymClass: true,
                gymSlotId: "slot-1",
                plannedTime: "07:00",
                estimatedDurationMinutes: 60,
                exercises: [],
                nutritionAdvice: "Carbs pre-workout",
              },
            ],
            reasoning: "WFH Day, locking BJJ first.",
          },
        },
      ],
    });

    // 2nd LLM call: returns conversational summary
    mockProvider.generateCompletion.mockResolvedValueOnce({
      text: "I have updated your schedule for this week. Locked in BJJ on Monday.",
    });

    const result = await runCoachAgent({
      userId,
      userMessage: "Plan my week",
      provider: mockProvider,
    });

    expect(result.text).toBe(
      "I have updated your schedule for this week. Locked in BJJ on Monday."
    );
    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0]?.name).toBe("replan_week_schedule");

    // Verify plan got persisted into Redis (14 days TTL key plan:userId:isoWeekId)
    const plan = await getWeeklyWorkoutPlan(userId, "2026_W35"); // Mock current date is 2026-08-29, which falls on W35
    expect(plan).not.toBeNull();
    expect(plan!.plan[0]?.focus).toBe("BJJ");
    expect(plan!.reasoning).toBe("WFH Day, locking BJJ first.");
  });

  it("executes log_lift_performance and appends it to athlete state in Redis", async () => {
    mockProvider.generateCompletion.mockResolvedValueOnce({
      toolCalls: [
        {
          name: "log_lift_performance",
          args: {
            date: "2026-08-29",
            exerciseName: "Deadlift",
            unit: "KG",
            sets: [
              {
                setNumber: 1,
                weight: 120,
                repsCompleted: 5,
                rpe: 8,
              },
            ],
            notes: "Felt strong.",
          },
        },
      ],
    });

    mockProvider.generateCompletion.mockResolvedValueOnce({
      text: "Got it, Deadlift is logged at 120kg. Keep progressing!",
    });

    const result = await runCoachAgent({
      userId,
      userMessage: "I did deadlifts: 120kg for 5 reps rpe 8",
      provider: mockProvider,
    });

    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0]?.name).toBe("log_lift_performance");

    // Verify state was appended and saved
    const state = await getAthleteState(userId);
    expect(state).not.toBeNull();
    expect(state!.lifts).toHaveLength(1);
    expect(state!.lifts[0]?.exerciseName).toBe("Deadlift");
    expect(state!.lifts[0]?.sets[0]?.weight).toBe(120);
    expect(state!.lifts[0]?.notes).toBe("Felt strong.");
  });

  it("executes log_athlete_event and updates athlete state in Redis", async () => {
    mockProvider.generateCompletion.mockResolvedValueOnce({
      toolCalls: [
        {
          name: "log_athlete_event",
          args: {
            date: "2026-08-29",
            type: "ILLNESS",
            severity: "MODERATE",
            notes: "Mild fever, resting today.",
          },
        },
      ],
    });

    mockProvider.generateCompletion.mockResolvedValueOnce({
      text: "Understood. Get some rest, illness logged. I will dial down intensity for upcoming workouts.",
    });

    const result = await runCoachAgent({
      userId,
      userMessage: "I have a fever, resting.",
      provider: mockProvider,
    });

    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0]?.name).toBe("log_athlete_event");

    const state = await getAthleteState(userId);
    expect(state).not.toBeNull();
    expect(state!.events).toHaveLength(1);
    expect(state!.events[0]?.type).toBe("ILLNESS");
    expect(state!.events[0]?.severity).toBe("MODERATE");
  });
});
