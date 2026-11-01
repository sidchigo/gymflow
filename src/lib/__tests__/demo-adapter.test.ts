import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAdapter,
  isDemoMode,
  setDemoModeOverride,
  MockDemoAdapter,
  LiveAdapter,
} from "@/lib/adapters";
import { DEMO_ATHLETE_STATE, getDemoAthleteState } from "@/lib/fixtures/demo-athlete";
import {
  STATIC_DEMO_TIMETABLE_SLOTS,
  getDemoTimetableSlots,
} from "@/lib/fixtures/demo-timetable";
import { AthleteStateSchema, type AthleteState } from "@/types/agent";

describe("Decoupled Provider/Adapter & Demo Sandbox Suite", () => {
  beforeEach(() => {
    setDemoModeOverride(null);
  });

  afterEach(() => {
    setDemoModeOverride(null);
  });

  describe("1. Provider / Adapter Mode Toggling", () => {
    it("resolves to LiveAdapter by default when demo mode is not enabled", () => {
      setDemoModeOverride(false);
      const adapter = getAdapter();
      expect(isDemoMode()).toBe(false);
      expect(adapter.mode).toBe("live");
      expect(adapter).toBeInstanceOf(LiveAdapter);
    });

    it("resolves to MockDemoAdapter when demo mode is enabled", () => {
      setDemoModeOverride(true);
      const adapter = getAdapter();
      expect(isDemoMode()).toBe(true);
      expect(adapter.mode).toBe("demo");
      expect(adapter).toBeInstanceOf(MockDemoAdapter);
    });
  });

  describe("2. Demo Fixtures Verification", () => {
    it("validates that pre-seeded athlete state strictly conforms to AthleteStateSchema", () => {
      const parsed = AthleteStateSchema.safeParse(DEMO_ATHLETE_STATE);
      expect(parsed.success).toBe(true);
    });

    it("verifies pre-seeded athlete profile contains a 5-day hybrid target and combat requirements", () => {
      const state = getDemoAthleteState();
      expect(state.profile.targetDaysPerWeek).toBe(5);
      expect(state.profile.mandatoryCombatSessions.kickboxing).toBeGreaterThanOrEqual(1);
      expect(state.profile.mandatoryCombatSessions.bjj).toBeGreaterThanOrEqual(1);
      expect(state.profile.modalities).toContain("KICKBOXING");
      expect(state.profile.modalities).toContain("BJJ");
      expect(state.profile.modalities).toContain("UPPER_HYPERTROPHY");
      expect(state.profile.modalities).toContain("LOWER_STRENGTH");
    });

    it("verifies pre-seeded athlete state includes realistic past lift history and fatigue markers", () => {
      const state = getDemoAthleteState();
      expect(state.lifts.length).toBeGreaterThanOrEqual(3);

      const bench = state.lifts.find((l) => l.exerciseName.includes("Bench Press"));
      expect(bench).toBeDefined();
      expect(bench?.sets[0]?.weight).toBe(70);

      const squat = state.lifts.find((l) => l.exerciseName.includes("Squat"));
      expect(squat).toBeDefined();
      expect(squat?.sets[0]?.weight).toBe(95);

      // Verify active fatigue / soreness event
      expect(state.events.length).toBeGreaterThanOrEqual(1);
      const sorenessEvent = state.events.find((e) => e.type === "SORENESS_OVERLOAD");
      expect(sorenessEvent).toBeDefined();
      expect(sorenessEvent?.notes).toContain("sparring");
    });

    it("verifies synthetic timetable contains weekly BJJ, Kickboxing, and open gym slots", () => {
      const slots = getDemoTimetableSlots("2026_W35");
      expect(slots.length).toBeGreaterThan(10);

      const titles = slots.map((s) => s.title.toLowerCase());
      const hasBJJ = titles.some((t) => t.includes("bjj"));
      const hasKickboxing = titles.some((t) => t.includes("kickbox"));
      const hasOpenGym = titles.some((t) => t.includes("open"));

      expect(hasBJJ).toBe(true);
      expect(hasKickboxing).toBe(true);
      expect(hasOpenGym).toBe(true);
    });

    it("verifies synthetic timetable slots dynamically align with requested ISO week dates", () => {
      const w35Slots = getDemoTimetableSlots("2026_W35");
      expect(w35Slots[0]?.date).toBe("2026-08-24"); // Monday of 2026_W35

      const w36Slots = getDemoTimetableSlots("2026_W36");
      expect(w36Slots[0]?.date).toBe("2026-08-31"); // Monday of 2026_W36
      expect(w36Slots.length).toBe(STATIC_DEMO_TIMETABLE_SLOTS.length);
    });
  });

  describe("3. In-Memory State & Mutation Persistence", () => {
    it("returns pre-seeded athlete state and persists mutations purely in memory", async () => {
      const demoAdapter = new MockDemoAdapter();
      const userId = "test-sandbox-user";

      const initial = await demoAdapter.getAthleteState(userId);
      expect(initial).not.toBeNull();
      expect(initial?.profile.userId).toBe(userId);
      expect(initial?.profile.targetDaysPerWeek).toBe(5);

      // Mutate target protein
      const updated: AthleteState = {
        ...initial!,
        profile: {
          ...initial!.profile,
          targetDailyProteinGrams: 160,
        },
      };
      await demoAdapter.saveAthleteState(userId, updated);

      const fetchedAgain = await demoAdapter.getAthleteState(userId);
      expect(fetchedAgain?.profile.targetDailyProteinGrams).toBe(160);
    });

    it("generates deterministic weekly workout plan on first fetch and persists mutations", async () => {
      const demoAdapter = new MockDemoAdapter();
      const userId = "test-sandbox-plan";
      const weekId = "2026_W35";

      const generatedPlan = await demoAdapter.getWeeklyWorkoutPlan(userId, weekId);
      expect(generatedPlan).not.toBeNull();
      expect(generatedPlan?.plan).toHaveLength(7);

      // Verify Sunday is rest
      const sunday = generatedPlan?.plan.find((d) => d.day === "Sunday");
      expect(sunday?.modality).toBe("REST");

      // Mutate one day (simulate 'skip today' event)
      const mutatedPlan = {
        ...generatedPlan!,
        plan: generatedPlan!.plan.map((day) =>
          day.day === "Monday"
            ? {
              ...day,
              modality: "REST" as const,
              focus: "Rest/Recovery (Missed Session)",
              exercises: [],
            }
            : day
        ),
      };

      await demoAdapter.saveWeeklyWorkoutPlan(userId, weekId, mutatedPlan);

      const fetchedPlan = await demoAdapter.getWeeklyWorkoutPlan(userId, weekId);
      const monday = fetchedPlan?.plan.find((d) => d.day === "Monday");
      expect(monday?.modality).toBe("REST");
      expect(monday?.focus).toContain("Missed Session");
    });

    it("isolates gym Bearer tokens in-memory without external Redis writes", async () => {
      const demoAdapter = new MockDemoAdapter();
      const userId = "sandbox-token-user";

      await demoAdapter.storeGymToken(userId, "sandbox-bearer-token-12345");
      const token = await demoAdapter.getGymToken(userId);
      expect(token).toBe("sandbox-bearer-token-12345");
    });

    it("resets sandbox demo state cleanly to fresh fixture baseline", async () => {
      const demoAdapter = new MockDemoAdapter();
      const userId = "demo-athlete";

      const state = await demoAdapter.getAthleteState(userId);
      state!.profile.targetDailyProteinGrams = 180;
      await demoAdapter.saveAthleteState(userId, state!);

      expect((await demoAdapter.getAthleteState(userId))?.profile.targetDailyProteinGrams).toBe(180);

      await demoAdapter.resetDemoState();

      const freshState = await demoAdapter.getAthleteState(userId);
      expect(freshState?.profile.targetDailyProteinGrams).toBe(145);
    });
  });
});
