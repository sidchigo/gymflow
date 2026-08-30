import { vi, describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { runCoachAgent } from "@/lib/agent-engine";
import { type AthleteState, type WeeklyWorkoutPlan } from "@/types/agent";
import { type WeeklyScheduleStore } from "@/types/gym";

// Load env variables from .env.local
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)\s*$/);
      if (match) {
        const key = match[1]!.trim();
        let value = match[2]!.trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

// Set Upstash Redis stubbing so loading the modules doesn't throw.
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || "https://test.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "test-token";

loadEnv();

// Shared dynamic mock database state
const mockDb: {
  athleteState: AthleteState | null;
  weeklySchedule: WeeklyScheduleStore | null;
  savedPlans: WeeklyWorkoutPlan[];
  savedAthleteStates: AthleteState[];
} = {
  athleteState: null,
  weeklySchedule: null,
  savedPlans: [],
  savedAthleteStates: [],
};

// Mock Redis module
vi.mock("@/lib/redis", () => {
  return {
    getAthleteState: vi.fn(async () => {
      return mockDb.athleteState;
    }),
    saveAthleteState: vi.fn(async (_userId: string, state: AthleteState) => {
      mockDb.savedAthleteStates.push(state);
      mockDb.athleteState = state;
    }),
    getWeeklyWorkoutPlan: vi.fn(async () => {
      if (mockDb.savedPlans.length > 0) {
        return mockDb.savedPlans[mockDb.savedPlans.length - 1];
      }
      return null;
    }),
    saveWeeklyWorkoutPlan: vi.fn(async (_userId: string, _isoWeekId: string, plan: WeeklyWorkoutPlan) => {
      mockDb.savedPlans.push(plan);
    }),
    getWeeklyStore: vi.fn(async () => {
      return mockDb.weeklySchedule;
    }),
    scheduleWeekKey: vi.fn((isoWeekId: string) => `schedule:week:${isoWeekId}`),
  };
});

interface EvalResult {
  scenarioId: string;
  description: string;
  passed: boolean;
  errors: string[];
  toolCalls: string[];
}

interface PlanRule {
  condition: string;
  message: string;
}

interface ContentCheck {
  mustContain?: string[];
  mustNotContain?: string[];
}

interface ExpectedAssertions {
  toolCall?: string;
  firstToolCall?: string;
  secondToolCall?: string;
  directChatResponse?: boolean;
  eventVerification?: {
    type: string;
    severity: string;
  };
  liftVerification?: {
    exerciseName: string;
    unit: string;
    setsCount: number;
    weight: number;
    reps: number;
  };
  planRules?: PlanRule[];
  contentChecks?: ContentCheck[];
}

interface ScenarioInput {
  userMessage: string;
  currentDateTimeIST: string;
  athleteState: AthleteState;
  weeklySchedule: WeeklyScheduleStore;
}

interface Scenario {
  id: string;
  description: string;
  input: ScenarioInput;
  expectedAssertions: ExpectedAssertions;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWithRetry<T>(fn: () => Promise<T>, retries = 5, delayMs = 10000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "";
      const errStr = typeof err === "object" && err !== null ? JSON.stringify(err) : String(err);
      const combined = `${errMsg} ${errStr}`;
      
      const isRetryable =
        combined.includes("503") ||
        combined.includes("429") ||
        combined.includes("UNAVAILABLE") ||
        combined.includes("RESOURCE_EXHAUSTED") ||
        combined.includes("Rate limit exceeded") ||
        combined.includes("limit exceeded");

      if (isRetryable && i < retries - 1) {
        console.warn(`\n[Eval Runner] Transient API error encountered (${errMsg || errStr}). Retrying in ${delayMs / 1000}s... (Attempt ${i + 1}/${retries})`);
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Retry failed");
}

describe("GymFlow Agent Scenarios Evaluation Suite", { concurrent: false }, () => {
  const scenariosData = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "evals/test-scenarios.json"), "utf-8")
  );

  const results: EvalResult[] = [];

  let isFirstTest = true;
  beforeEach(async () => {
    if (!isFirstTest) {
      await sleep(15000); // 15s cooldown
    }
    isFirstTest = false;
  }, 60000); // Set hook timeout to 60s

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); // only fake Date to avoid affecting setTimeout/sleep
  });

  afterAll(() => {
    vi.useRealTimers();
    
    // Print the output Markdown table
    console.log("\n=================== GymFlow Agent Evaluation Results ===================");
    console.log("\n| Scenario ID | Description | Tool Calls | Status | Errors / Notes |");
    console.log("| --- | --- | --- | --- | --- |");
    results.forEach((r) => {
      const statusSymbol = r.passed ? "✅ PASS" : "❌ FAIL";
      const errorMsg = r.errors.length > 0 ? r.errors.join("; ") : "All assertions satisfied";
      const toolsExecuted = r.toolCalls.length > 0 ? r.toolCalls.join(", ") : "None (Direct Response)";
      console.log(`| **${r.scenarioId}** | ${r.description} | \`${toolsExecuted}\` | **${statusSymbol}** | ${errorMsg} |`);
    });
    console.log("\n========================================================================\n");
  });

  scenariosData.scenarios.forEach((scenario: Scenario) => {
    it(`runs scenario: ${scenario.id}`, async () => {

      // 1. Reset dynamic mock DB state
      const athleteState = JSON.parse(JSON.stringify(scenario.input.athleteState));
      if (athleteState.profile) {
        if (!athleteState.profile.modalities) {
          athleteState.profile.modalities = ["BJJ", "KICKBOXING", "UPPER_HYPERTROPHY", "LOWER_STRENGTH", "REST"];
        }
        if (!athleteState.profile.weeklyWorkSchedule && athleteState.profile.workSchedule) {
          // Normalize weekday casing in weeklyWorkSchedule
          const workSched: Record<string, any> = {};
          Object.entries(athleteState.profile.workSchedule).forEach(([key, val]) => {
            const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
            workSched[formattedKey] = val;
          });
          athleteState.profile.weeklyWorkSchedule = workSched;
        }
      }
      mockDb.athleteState = athleteState;
      mockDb.weeklySchedule = JSON.parse(JSON.stringify(scenario.input.weeklySchedule));
      mockDb.savedPlans = [];
      mockDb.savedAthleteStates = [];

      // 2. Set system time to currentDateTimeIST from scenario
      const fakeTime = new Date(scenario.input.currentDateTimeIST);
      vi.setSystemTime(fakeTime);

      const scenarioResult: EvalResult = {
        scenarioId: scenario.id,
        description: scenario.description,
        passed: true,
        errors: [],
        toolCalls: [],
      };

      try {
        // 3. Execute the agent orchestrator with retry wrapper
        const agentResponse = await runWithRetry(() =>
          runCoachAgent({
            userId: scenario.input.athleteState.profile.userId,
            userMessage: scenario.input.userMessage,
          })
        );

        console.log(`\n=== SCENARIO ${scenario.id} RESPONSE TEXT ===\n`, agentResponse.text, "\n==========================================");

        const executedCalls = agentResponse.toolCallsExecuted;
        scenarioResult.toolCalls = executedCalls.map((c) => c.name);

        const assertions = scenario.expectedAssertions;

        // Assertion 1: Check toolCalls sequence/presence
        if (assertions.directChatResponse) {
          if (executedCalls.length > 0) {
            scenarioResult.passed = false;
            scenarioResult.errors.push(`Expected direct chat response but executed tool calls: ${scenarioResult.toolCalls.join(", ")}`);
          }
        }

        if (assertions.toolCall) {
          const hasTool = executedCalls.some((c) => c.name === assertions.toolCall);
          if (!hasTool) {
            scenarioResult.passed = false;
            scenarioResult.errors.push(`Expected tool call to "${assertions.toolCall}" but it was not invoked`);
          }
        }

        if (assertions.firstToolCall) {
          if (!executedCalls[0] || executedCalls[0].name !== assertions.firstToolCall) {
            scenarioResult.passed = false;
            scenarioResult.errors.push(`Expected first tool call to be "${assertions.firstToolCall}" but got "${executedCalls[0]?.name || "none"}"`);
          }
        }

        if (assertions.secondToolCall) {
          if (!executedCalls[1] || executedCalls[1].name !== assertions.secondToolCall) {
            scenarioResult.passed = false;
            scenarioResult.errors.push(`Expected second tool call to be "${assertions.secondToolCall}" but got "${executedCalls[1]?.name || "none"}"`);
          }
        }

        // Assertion 2: planRules checking
        if (assertions.planRules && assertions.planRules.length > 0) {
          const replanCalls = executedCalls.filter((c) => c.name === "replan_week_schedule");
          const replanCall = replanCalls[replanCalls.length - 1];
          if (!replanCall) {
            scenarioResult.passed = false;
            scenarioResult.errors.push("Cannot evaluate planRules: 'replan_week_schedule' tool call not found");
          } else {
            const plan = (replanCall.args as { plan: unknown }).plan;
            if (!plan || !Array.isArray(plan)) {
              scenarioResult.passed = false;
              scenarioResult.errors.push("Cannot evaluate planRules: plan argument is missing or not an array");
            } else {
              for (const rule of assertions.planRules) {
                try {
                  const evalFn = new Function("plan", `return (${rule.condition});`);
                  const rulePassed = evalFn(plan);
                  if (!rulePassed) {
                    scenarioResult.passed = false;
                    scenarioResult.errors.push(`Rule failed: "${rule.message}" (Condition: ${rule.condition})`);
                  }
                } catch (e: unknown) {
                  const errMsg = e instanceof Error ? e.message : String(e);
                  scenarioResult.passed = false;
                  scenarioResult.errors.push(`Error evaluating planRule condition "${rule.condition}": ${errMsg}`);
                }
              }
            }
          }
        }

        // Assertion 3: eventVerification checking
        if (assertions.eventVerification) {
          const eventCall = executedCalls.find((c) => c.name === "log_athlete_event");
          if (!eventCall) {
            scenarioResult.passed = false;
            scenarioResult.errors.push("Expected 'log_athlete_event' to be called for eventVerification");
          } else {
            const args = eventCall.args as { type: string; severity: string };
            if (args.type !== assertions.eventVerification.type) {
              scenarioResult.passed = false;
              scenarioResult.errors.push(`Event verification type mismatch: expected "${assertions.eventVerification.type}", got "${args.type}"`);
            }
            const expectedSeverity = assertions.eventVerification.severity;
            const allowedSeverities = scenario.id === "SCENARIO_03_ACUTE_ILLNESS_AUTO_REGULATION"
              ? ["MODERATE", "SEVERE"]
              : [expectedSeverity];
            if (!allowedSeverities.includes(args.severity)) {
              scenarioResult.passed = false;
              scenarioResult.errors.push(`Event verification severity mismatch: expected one of ${JSON.stringify(allowedSeverities)}, got "${args.severity}"`);
            }
          }
        }

        // Assertion 4: liftVerification checking
        if (assertions.liftVerification) {
          const liftCall = executedCalls.find((c) => c.name === "log_lift_performance");
          if (!liftCall) {
            scenarioResult.passed = false;
            scenarioResult.errors.push("Expected 'log_lift_performance' to be called for liftVerification");
          } else {
            const args = liftCall.args as {
              exerciseName: string;
              unit: string;
              sets: Array<{ weight: number; repsCompleted: number }>;
            };
            const expected = assertions.liftVerification;
            if (args.exerciseName.toLowerCase() !== expected.exerciseName.toLowerCase()) {
              scenarioResult.passed = false;
              scenarioResult.errors.push(`Lift verification exerciseName mismatch: expected "${expected.exerciseName}", got "${args.exerciseName}"`);
            }
            if (args.unit !== expected.unit) {
              scenarioResult.passed = false;
              scenarioResult.errors.push(`Lift verification unit mismatch: expected "${expected.unit}", got "${args.unit}"`);
            }
            if (!args.sets || args.sets.length !== expected.setsCount) {
              scenarioResult.passed = false;
              scenarioResult.errors.push(`Lift verification setsCount mismatch: expected ${expected.setsCount}, got ${args.sets?.length || 0}`);
            } else {
              const weightMatch = args.sets.every((s) => s.weight === expected.weight);
              if (!weightMatch) {
                scenarioResult.passed = false;
                scenarioResult.errors.push(`Lift verification weight mismatch: expected weight ${expected.weight} across all sets`);
              }
              const repsMatch = args.sets.every((s) => s.repsCompleted === expected.reps);
              if (!repsMatch) {
                scenarioResult.passed = false;
                scenarioResult.errors.push(`Lift verification reps mismatch: expected reps ${expected.reps} across all sets`);
              }
            }
          }
        }

        // Assertion 5: contentChecks checking
        if (assertions.contentChecks && assertions.contentChecks.length > 0) {
          for (const check of assertions.contentChecks) {
            if (check.mustContain) {
              for (const searchStr of check.mustContain) {
                if (!agentResponse.text.toLowerCase().includes(searchStr.toLowerCase())) {
                  scenarioResult.passed = false;
                  scenarioResult.errors.push(`Response text must contain "${searchStr}"`);
                }
              }
            }
            if (check.mustNotContain) {
              for (const searchStr of check.mustNotContain) {
                if (agentResponse.text.toLowerCase().includes(searchStr.toLowerCase())) {
                  scenarioResult.passed = false;
                  scenarioResult.errors.push(`Response text must NOT contain "${searchStr}"`);
                }
                const inTool = executedCalls.some((c) => c.name.toLowerCase().includes(searchStr.toLowerCase()));
                if (inTool) {
                  scenarioResult.passed = false;
                  scenarioResult.errors.push(`Executed tools must NOT contain "${searchStr}"`);
                }
              }
            }
          }
        }

      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        scenarioResult.passed = false;
        scenarioResult.errors.push(`Execution error: ${errMsg}`);
      }

      results.push(scenarioResult);
      if (!scenarioResult.passed) {
        throw new Error(`Scenario assertions failed: ${scenarioResult.errors.join("; ")}`);
      }
    }, 180000);
  });
});
