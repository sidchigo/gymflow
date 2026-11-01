/**
 * @file src/lib/adapters/mock-demo-adapter.ts
 * @description In-memory, self-contained mock demo adapter for recruiter sandbox.
 * Backed by synthetic fixtures (BJJ, Kickboxing, Open Gym) and pre-seeded athlete state.
 */

import { type IGymflowAdapter } from "./types";
import { type AthleteState, type WeeklyWorkoutPlan } from "@/types/agent";
import { type WeeklyScheduleStore } from "@/types/gym";
import { getDemoAthleteState } from "../fixtures/demo-athlete";
import { getDemoTimetableSlots } from "../fixtures/demo-timetable";
import { generateDeterministicWeekPlan } from "../deterministic-planner";

export class MockDemoAdapter implements IGymflowAdapter {
  readonly mode = "demo" as const;

  private athleteStates = new Map<string, AthleteState>();
  private weeklyPlans = new Map<string, WeeklyWorkoutPlan>();
  private weeklySchedules = new Map<string, WeeklyScheduleStore>();
  private gymTokens = new Map<string, string>();

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    const defaultUserId = "demo-athlete";
    const defaultState = getDemoAthleteState(defaultUserId);
    this.athleteStates.set(defaultUserId, defaultState);
    this.gymTokens.set(defaultUserId, "mock-demo-gym-token-signature");
  }

  async getAthleteState(userId: string): Promise<AthleteState | null> {
    const existing = this.athleteStates.get(userId);
    if (existing) {
      return JSON.parse(JSON.stringify(existing));
    }

    // Initialize with pre-seeded demo athlete state if unknown user in demo mode
    const seeded = getDemoAthleteState(userId);
    this.athleteStates.set(userId, seeded);
    return JSON.parse(JSON.stringify(seeded));
  }

  async saveAthleteState(userId: string, state: AthleteState): Promise<void> {
    this.athleteStates.set(userId, JSON.parse(JSON.stringify(state)));
  }

  async getWeeklyWorkoutPlan(userId: string, isoWeekId: string): Promise<WeeklyWorkoutPlan | null> {
    const key = `${userId}:${isoWeekId}`;
    const existing = this.weeklyPlans.get(key);
    if (existing) {
      return JSON.parse(JSON.stringify(existing));
    }

    // Auto-generate deterministic plan on first fetch using fixtures
    const athleteState = (await this.getAthleteState(userId)) || getDemoAthleteState(userId);
    const slots = getDemoTimetableSlots(isoWeekId);
    const generated = generateDeterministicWeekPlan({
      athleteState,
      weeklyGymStoreSlots: slots,
      currentDateIST: slots[0]?.date ? `${slots[0].date}T08:00:00+05:30` : "2026-08-24T08:00:00+05:30",
    });

    this.weeklyPlans.set(key, JSON.parse(JSON.stringify(generated)));
    return JSON.parse(JSON.stringify(generated));
  }

  async saveWeeklyWorkoutPlan(
    userId: string,
    isoWeekId: string,
    plan: WeeklyWorkoutPlan
  ): Promise<void> {
    const key = `${userId}:${isoWeekId}`;
    this.weeklyPlans.set(key, JSON.parse(JSON.stringify(plan)));
  }

  async getWeeklySchedule(_userId: string, isoWeekId: string): Promise<WeeklyScheduleStore> {
    const existing = this.weeklySchedules.get(isoWeekId);
    if (existing) {
      return JSON.parse(JSON.stringify(existing));
    }

    const slots = getDemoTimetableSlots(isoWeekId);
    const store: WeeklyScheduleStore = {
      slots,
      diffs: [],
      lastFetchedAt: new Date().toISOString(),
    };

    this.weeklySchedules.set(isoWeekId, store);
    return JSON.parse(JSON.stringify(store));
  }

  async syncWeeklySchedule(
    userId: string,
    options?: { forceRefresh?: boolean | undefined; targetWeekId?: string | undefined } | undefined
  ): Promise<WeeklyScheduleStore> {
    const weekId = options?.targetWeekId || "2026_W35";
    return this.getWeeklySchedule(userId, weekId);
  }

  async getGymToken(userId: string): Promise<string | null> {
    return this.gymTokens.get(userId) || "mock-demo-gym-token-signature";
  }

  async storeGymToken(userId: string, token: string): Promise<void> {
    this.gymTokens.set(userId, token);
  }

  async resetDemoState(): Promise<void> {
    this.athleteStates.clear();
    this.weeklyPlans.clear();
    this.weeklySchedules.clear();
    this.gymTokens.clear();
    this.seedDefaults();
  }
}
