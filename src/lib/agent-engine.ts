/**
 * @file src/lib/agent-engine.ts
 * @spec SPEC-004 – AI Coach Engine & Adaptive Planning Workflow
 *
 * The autonomous athletic coaching agent orchestrator. It manages:
 *   1. Context assembly (fetching athlete state, gym schedule, current plan).
 *   2. Prompt engineering (Persona, athletic rules, safety rules).
 *   3. LLM tool definitions & execution loop.
 *   4. State mutation (saving weekly plan, appending lift history/events).
 */

import {
  getAthleteState,
  saveAthleteState,
  getWeeklyWorkoutPlan,
  saveWeeklyWorkoutPlan,
  getWeeklyStore,
  saveWeeklyStore,
  scheduleWeekKey,
} from "@/lib/redis";
import { weekKey, nowIST, nowISTDateTime } from "@/lib/schedule-service";
import {
  type LLMMessage,
  type LLMToolDefinition,
  type LLMProvider,
  GeminiLLMProvider,
  getDefaultLLMProvider,
} from "@/lib/llm-provider";
import {
  ReplanWeekScheduleArgsSchema,
  LogLiftPerformanceArgsSchema,
  LogAthleteEventArgsSchema,
  type AthleteState,
  type WeeklyWorkoutPlan,
} from "@/types/agent";

// ---------------------------------------------------------------------------
// 1. Tool Declarations
// ---------------------------------------------------------------------------

export const replanWeekScheduleTool: LLMToolDefinition = {
  name: "replan_week_schedule",
  description:
    "Generates or modifies the weekly 7-day athletic workout and recovery plan with progressive overload targets, supersets, and nutrition advice based on available gym classes and athlete profile constraints.",
  parameters: {
    type: "OBJECT",
    properties: {
      plan: {
        type: "ARRAY",
        description: "The 7-day plan from Monday through Sunday.",
        items: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING", description: "YYYY-MM-DD format (IST)" },
            day: { type: "STRING", description: "Monday, Tuesday, etc." },
            focus: {
              type: "STRING",
              description:
                'Primary session objective (e.g., "BJJ + Grip Conditioning", "Upper Hypertrophy (Supersets)")',
            },
            modality: {
              type: "STRING",
              enum: [
                "KICKBOXING",
                "BJJ",
                "UPPER_HYPERTROPHY",
                "LOWER_STRENGTH",
                "BOXING_CONDITIONING",
                "KB_CONDITIONING",
                "DUT",
                "TRX",
                "AB_ASSAULT",
                "MOBILITY_RECOVERY",
                "REST",
              ],
            },
            isGymClass: {
              type: "BOOLEAN",
              description: "True if mapped to a scheduled gym class",
            },
            gymSlotId: {
              type: "STRING",
              description: "Slot ID from gym schedule if isGymClass is true",
              nullable: true,
            },
            plannedTime: { type: "STRING", description: "HH:mm (24-hr IST)" },
            estimatedDurationMinutes: { type: "NUMBER", nullable: true },
            exercises: {
              type: "ARRAY",
              description:
                "Prescribed exercises with progressive overload targets and optional superset groupings.",
              items: {
                type: "OBJECT",
                properties: {
                  name: {
                    type: "STRING",
                    description: 'e.g. "Barbell Bench Press", "Dumbbell Row"',
                  },
                  sets: { type: "NUMBER", description: "Number of working sets" },
                  reps: {
                    type: "STRING",
                    description: 'Target rep scheme (e.g. "5", "8-10", "AMRAP")',
                  },
                  targetWeight: {
                    type: "NUMBER",
                    description: "Prescribed weight value based on history",
                    nullable: true,
                  },
                  unit: { type: "STRING", enum: ["KG", "LBS"] },
                  targetRpe: {
                    type: "NUMBER",
                    description: "Target RPE (1-10 scale)",
                    nullable: true,
                  },
                  restSeconds: {
                    type: "NUMBER",
                    description: "Rest period in seconds after this set/exercise",
                  },
                  supersetGroupId: {
                    type: "STRING",
                    description:
                      'Short identifier like "A" or "B" for exercises done back-to-back. Null if standalone.',
                    nullable: true,
                  },
                  orderInGroup: {
                    type: "NUMBER",
                    description:
                      "Order within the superset (e.g. 1 for A1, 2 for A2)",
                    nullable: true,
                  },
                  progressionNote: {
                    type: "STRING",
                    description:
                      'Progression directive (e.g. "+5 lbs over last week")',
                    nullable: true,
                  },
                },
                required: ["name", "sets", "reps", "unit", "restSeconds"],
              },
            },
            nutritionAdvice: {
              type: "STRING",
              description:
                "Specific pre/post workout fuel recommendation based on session demand.",
            },
          },
          required: [
            "date",
            "day",
            "focus",
            "modality",
            "isGymClass",
            "plannedTime",
            "exercises",
            "nutritionAdvice",
          ],
        },
      },
      reasoning: {
        type: "STRING",
        description:
          "Clear coaching explanation of why this split was selected given the work schedule, fatigue, and gym timetable.",
      },
    },
    required: ["plan", "reasoning"],
  },
};

export const logLiftPerformanceTool: LLMToolDefinition = {
  name: "log_lift_performance",
  description:
    "Logs completed weight lifting sets, reps, load, and unit to maintain progressive overload records.",
  parameters: {
    type: "OBJECT",
    properties: {
      date: { type: "STRING", description: "YYYY-MM-DD (IST)" },
      exerciseName: {
        type: "STRING",
        description: "Exercise name matching standard movement library",
      },
      unit: { type: "STRING", enum: ["KG", "LBS"] },
      sets: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            setNumber: { type: "NUMBER" },
            weight: { type: "NUMBER" },
            repsCompleted: { type: "NUMBER" },
            rpe: { type: "NUMBER", nullable: true },
          },
          required: ["setNumber", "weight", "repsCompleted"],
        },
      },
      notes: {
        type: "STRING",
        description: "Observations on form, velocity, or joint fatigue.",
        nullable: true,
      },
    },
    required: ["date", "exerciseName", "unit", "sets"],
  },
};

export const logAthleteEventTool: LLMToolDefinition = {
  name: "log_athlete_event",
  description:
    "Logs an unexpected health or schedule constraint such as illness, acute soreness/overload, travel, or missed workout.",
  parameters: {
    type: "OBJECT",
    properties: {
      date: { type: "STRING", description: "YYYY-MM-DD IST" },
      type: {
        type: "STRING",
        enum: ["ILLNESS", "MISSED_SESSION", "SORENESS_OVERLOAD", "TRAVEL_WORK"],
      },
      severity: { type: "STRING", enum: ["MILD", "MODERATE", "SEVERE"] },
      notes: { type: "STRING", description: "Details reported by user." },
    },
    required: ["date", "type", "severity", "notes"],
  },
};

export const toolsList = [
  replanWeekScheduleTool,
  logLiftPerformanceTool,
  logAthleteEventTool,
];

// ---------------------------------------------------------------------------
// 2. System Prompt Builder
// ---------------------------------------------------------------------------

export function buildSystemPrompt(params: {
  athleteState: AthleteState;
  gymScheduleSlots: string; // pre-formatted compact string
  gymScheduleDiffs: string; // pre-formatted compact string
  currentPlan: string; // pre-formatted current plan
  currentDateIST: string;
}): string {
  const profile = params.athleteState.profile;

  return `You are GymFlow Coach, an elite, world-class Strength & Conditioning (S&C) and MMA head coach.
Your tone is grounded, direct, athletic, and actionable. You never use fluffy greetings, corporate buzzwords, or generic advice.

GROUND TRUTH RULES:
1. You MUST ONLY schedule class activities (like BJJ, Kickboxing, DUT, TRX, etc.) that match valid slots in the Gym Timetable provided below.
2. Timetable Sync & Fallback: When the next week's gym schedule timetable slots list is empty or shows "(No scheduled classes found)", you MUST explicitly write in your response text the exact word "unpublished" to warn the user that next week's official gym schedule has not been published yet. Explain to the user that next week's schedule is unpublished, generate a provisional open-floor strength and conditioning split so they have a baseline plan (by calling the tool), and advise them to run 'Sync Gym Schedule' once it is published.
3. For non-class slots (e.g. UPPER_HYPERTROPHY, LOWER_STRENGTH, REST, MOBILITY_RECOVERY), you can schedule them as needed during standard open hours.
4. You MUST NOT modify the weekly plan or log workout performance in plain text. Any plan creation, modification, lift logging, or event logging MUST be done by calling the appropriate tool.
5. Saturday can only be scheduled for morning sessions, and ONLY if a weekday workout was missed or requested. Sunday is strictly REST (no workouts).
6. When a scheduled combat session (BJJ/KB) is cancelled, replace it with an alternative conditioning (KB/Boxing/DUT/TRX) or strength session that maintains the 5-day training goal.
7. You MUST NOT render full weekly calendar grids, Markdown tables, or full day-by-day schedules in your text response. The user interface already has a dedicated schedule viewer for this. Instead, focus on a brief coaching explanation of the changes or the plan rationale.

ATHLETIC REASONING & PERIODIZATION RULES:
1. Combat Priority: Lock in the 2 combat sports sessions (Kickboxing & BJJ) first, strictly mapping them to verified gym slots.
2. Commute & Energy:
   - WFH Days (Low friction, high recovery): Allocate high-demand sessions (Heavy Compounds, Sparring, Hard conditioning).
   - WFO Days (High commute friction): Shorter, high-density sessions (TRX, Ab Assault, Boxing Conditioning, Antagonistic Supersets e.g., Push + Pull A1/A2) or designate as rest/recovery.
3. Progressive Overload:
   - Compounds (Squats, Deadlifts, Bench, OHP): Linear loading (+2.5 kg / +5 lbs) when sets/reps targets at target RPE are met.
   - Accessories: Double progression (hold weight steady until reaching upper bound reps across all sets, e.g. 3x12, then increase).
   - Working Weights: You MUST ALWAYS specify a numeric target working weight (targetWeight) for all weightlifting and resistance exercises. If the athlete has no logged lift history for an exercise yet, estimate a safe, conservative baseline starting weight based on their body weight and modality (e.g. 15-20% of body weight for dumbbell accessories) rather than leaving it null or empty.
4. Auto-Regulation & Safety Invariants:
   - Illness, fever, or acute joint pain reports REQUIRE canceling high-intensity sessions and programming REST/mobility recovery. When an athlete reports acute illness, fever, or severe systemic fatigue on a given day, you MUST convert BOTH the current day and at least the following day (a minimum 48-hour rest buffer) to 'REST' or 'MOBILITY_RECOVERY' before re-introducing training.
   - NEVER program heavy lower-body compound lifts (Squat, Deadlift) within 12 hours before or immediately after high-intensity BJJ/Kickboxing sparring.
   - Cap lift intensity at RPE <= 7.5 on sessions immediately following high-output combat sessions.
5. Nutrition:
   - Training Days: High pre-workout carbs (40-60g) 90-120 min before, electrolytes (for hydration), and 35-40g protein post-workout.
   - Rest Days: Baseline protein distribution (4 x 30g meals) without excess carbohydrate loading.

---
CURRENT CONTEXT (Current Date/Time IST: ${params.currentDateIST})

---
ATHLETE PROFILE:
- Weight: ${profile.weightKg ?? 70} kg (Preferred unit: ${(profile as any).weightUnitPreference ?? (profile as any).unitPreference ?? "KG"})
- Height: ${profile.heightCm ?? 170} cm
- Modalities: ${(profile.modalities ?? []).join(", ")}
- Target Days/Week: ${profile.targetDaysPerWeek ?? 5}
- Mandatory Combat: Kickboxing (${profile.mandatoryCombatSessions?.kickboxing ?? (profile as any).weeklyCommitments?.kickboxingClasses ?? 0}/wk), BJJ (${profile.mandatoryCombatSessions?.bjj ?? (profile as any).weeklyCommitments?.bjjClasses ?? 0}/wk)
- Dietary Preference: ${profile.dietaryPreference ?? "BALANCED"}
- Daily Protein Target: ${profile.targetDailyProteinGrams ?? 125}g
- Weekly Work Schedule:
${Object.entries((profile as any).weeklyWorkSchedule ?? (profile as any).workSchedule ?? {})
  .map(([day, s]) => `  * ${day}: ${(s as any).mode} (Commute: ${(s as any).commuteMinutesOneWay} mins one way)`)
  .join("\n")}

---
LIFT HISTORY BASES:
${
  (params.athleteState.lifts || []).length === 0
    ? "  (No lift records logged yet)"
    : (params.athleteState.lifts || [])
        .slice(-10)
        .map((l) => {
          const setsStr = l.sets
            .map((s) => `${s.setNumber}: ${s.weight} ${s.unit} x ${s.repsCompleted} reps (RPE ${s.rpe || "N/A"})`)
            .join(", ");
          return `  * ${l.date} - ${l.exerciseName}: [${setsStr}]${l.notes ? ` Notes: ${l.notes}` : ""}`;
        })
        .join("\n")
}

---
ATHLETE EVENTS (Recent health/schedule incidents):
${
  (params.athleteState.events || []).length === 0
    ? "  (No health/schedule disruptions logged)"
    : (params.athleteState.events || [])
        .slice(-5)
        .map((e) => `  * ${e.date} [${e.type}] Severity: ${e.severity}. Details: ${e.notes}`)
        .join("\n")
}

---
GYM TIMETABLE SLOTS:
${params.gymScheduleSlots}

---
GYM TIMETABLE DIFF ALERTS (Cancellations/reschedules):
${params.gymScheduleDiffs}

---
ACTIVE WEEK PLAN:
${params.currentPlan}
`;
}

// ---------------------------------------------------------------------------
// 3. Execution & Orchestration Loop
// ---------------------------------------------------------------------------

export interface AgentResult {
  text: string;
  toolCallsExecuted: Array<{
    name: string;
    args: Record<string, unknown>;
    result: string;
  }>;
}

export async function runCoachAgent(params: {
  userId: string;
  userMessage: string;
  chatHistory?: LLMMessage[];
  provider?: LLMProvider;
  model?: string;
}): Promise<AgentResult> {
  const { userId, userMessage, chatHistory = [], model } = params;
  const provider = params.provider || getDefaultLLMProvider();

  // 1. Resolve current week and dates
  const now = new Date();
  const isoWeekId = weekKey(now);
  const currentDateIST = nowISTDateTime();



  // 2. Fetch state in parallel from Redis
  const scheduleStoreKey = scheduleWeekKey(isoWeekId);
  const [athleteState, weeklyGymStore, currentPlanDoc] = await Promise.all([
    getAthleteState(userId),
    getWeeklyStore(scheduleStoreKey),
    getWeeklyWorkoutPlan(userId, isoWeekId),
  ]);

  if (!athleteState) {
    throw new Error(`Athlete profile/state not found for user: ${userId}`);
  }

  // 3. Formulate prompt context elements
  const slotsText =
    weeklyGymStore?.slots && weeklyGymStore.slots.length > 0
      ? weeklyGymStore.slots
          .map((s) => `  * Slot [${s.id}] - ${s.date} (${s.startTime}-${s.endTime}): ${s.title} by ${s.trainer}`)
          .join("\n")
      : "  (No scheduled classes found)";

  const diffsText =
    weeklyGymStore?.diffs && weeklyGymStore.diffs.length > 0
      ? weeklyGymStore.diffs
          .map((d) => `  * [${d.type}] Slot [${d.slotId}] - ${d.title} on ${d.date} original time: ${d.originalTime}`)
          .join("\n")
      : "  (No class changes/cancellations detected)";

  const currentPlanText = currentPlanDoc
    ? currentPlanDoc.plan
        .map((p) => {
          const exercisesStr = p.exercises
            .map(
              (e) =>
                `    - ${e.name} ${e.sets}x${e.reps} @ ${e.targetWeight || "?"} ${e.unit} (RPE ${e.targetRpe || "N/A"})${
                  e.supersetGroupId ? ` [Super: ${e.supersetGroupId}${e.orderInGroup || ""}]` : ""
                }`
            )
            .join("\n");
          return `  * ${p.date} (${p.day}) - ${p.focus} [${p.modality}] (Time: ${p.plannedTime})\n${exercisesStr}\n    Fuel: ${p.nutritionAdvice}`;
        })
        .join("\n")
    : "  (No active weekly plan found)";

  const systemPrompt = buildSystemPrompt({
    athleteState,
    gymScheduleSlots: slotsText,
    gymScheduleDiffs: diffsText,
    currentPlan: currentPlanText,
    currentDateIST,
  });

  // 4. Set up message queue
  const messages: LLMMessage[] = [
    { role: "system", parts: [{ text: systemPrompt }] },
    ...chatHistory,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const toolCallsExecuted: AgentResult["toolCallsExecuted"] = [];
  let loopCount = 0;
  const maxLoops = 5;

  while (loopCount < maxLoops) {
    loopCount++;

    const completionParams: {
      messages: LLMMessage[];
      tools?: LLMToolDefinition[];
      model?: string;
    } = { messages };

    if (toolsList) {
      completionParams.tools = toolsList;
    }
    if (model) {
      completionParams.model = model;
    }

    const completion = await provider.generateCompletion(completionParams);

    // Check if the LLM returned tool calls
    if (completion.toolCalls && completion.toolCalls.length > 0) {
      // Append model message to history
      messages.push({
        role: "model",
        parts: completion.toolCalls.map((tc) => ({
          functionCall: {
            name: tc.name,
            args: tc.args,
          },
        })),
      });

      // Execute each tool call
      const responseParts: LLMMessage["parts"] = [];

      for (const call of completion.toolCalls) {
        let executionResult: string;
        try {
          if (call.name === "replan_week_schedule") {
            const args = ReplanWeekScheduleArgsSchema.parse(call.args);
            const fullPlan: WeeklyWorkoutPlan = {
              plan: args.plan,
              reasoning: args.reasoning,
              updatedAt: nowIST(),
            };
            await saveWeeklyWorkoutPlan(userId, isoWeekId, fullPlan);

            // Clear schedule diffs once a plan has been updated/synced to resolve notification banner
            const storeKey = scheduleWeekKey(isoWeekId);
            const store = await getWeeklyStore(storeKey);
            if (store) {
              store.diffs = [];
              await saveWeeklyStore(storeKey, store);
            }

            executionResult = JSON.stringify({
              success: true,
              message: "Weekly plan successfully generated/updated and saved to Redis.",
            });
          } else if (call.name === "log_lift_performance") {
            const args = LogLiftPerformanceArgsSchema.parse(call.args);
            athleteState.lifts.push({
              date: args.date,
              exerciseName: args.exerciseName,
              sets: args.sets.map((s) => ({
                setNumber: s.setNumber,
                weight: s.weight,
                unit: args.unit,
                repsCompleted: s.repsCompleted,
                rpe: s.rpe,
              })),
              notes: args.notes,
            });
            await saveAthleteState(userId, athleteState);
            executionResult = JSON.stringify({
              success: true,
              message: `Lifting performance for "${args.exerciseName}" logged.`,
            });
          } else if (call.name === "log_athlete_event") {
            const args = LogAthleteEventArgsSchema.parse(call.args);
            athleteState.events.push({
              date: args.date,
              type: args.type,
              severity: args.severity,
              notes: args.notes,
            });
            await saveAthleteState(userId, athleteState);
            executionResult = JSON.stringify({
              success: true,
              message: `Event [${args.type}] logged. Coach will auto-regulate intensity/planning.`,
            });
          } else {
            executionResult = JSON.stringify({
              error: `Unknown tool: ${call.name}`,
            });
          }
        } catch (err: any) {
          executionResult = JSON.stringify({
            error: err.message || "Failed to execute tool",
          });
        }

        toolCallsExecuted.push({
          name: call.name,
          args: call.args,
          result: executionResult,
        });

        responseParts.push({
          functionResponse: {
            name: call.name,
            response: JSON.parse(executionResult),
          },
        });
      }

      // Append function responses to the thread and continue loop
      messages.push({
        role: "user", // For Google GenAI, function results are passed as part of user role messages
        parts: responseParts,
      });
    } else {
      // Final message, return text
      return {
        text: completion.text || "No response text generated.",
        toolCallsExecuted,
      };
    }
  }

  throw new Error("Coach agent execution exceeded maximum tool calling loops.");
}

export async function runCoachAgentStream(params: {
  userId: string;
  userMessage: string;
  chatHistory?: LLMMessage[];
  provider?: GeminiLLMProvider;
  model?: string;
  onEvent: (event: {
    type: "text" | "tool_start" | "tool_end";
    text?: string;
    name?: string;
    args?: Record<string, unknown>;
    result?: string;
  }) => void;
}): Promise<AgentResult> {
  const { userId, userMessage, chatHistory = [], model, onEvent } = params;
  const provider = params.provider || getDefaultLLMProvider();

  // 1. Resolve current week and dates
  const now = new Date();
  const isoWeekId = weekKey(now);
  const currentDateIST = nowISTDateTime();

  // 2. Fetch state in parallel from Redis
  const scheduleStoreKey = scheduleWeekKey(isoWeekId);
  const [athleteState, weeklyGymStore, currentPlanDoc] = await Promise.all([
    getAthleteState(userId),
    getWeeklyStore(scheduleStoreKey),
    getWeeklyWorkoutPlan(userId, isoWeekId),
  ]);

  if (!athleteState) {
    throw new Error(`Athlete profile/state not found for user: ${userId}`);
  }

  // 3. Formulate prompt context elements
  const slotsText =
    weeklyGymStore?.slots && weeklyGymStore.slots.length > 0
      ? weeklyGymStore.slots
          .map((s) => `  * Slot [${s.id}] - ${s.date} (${s.startTime}-${s.endTime}): ${s.title} by ${s.trainer}`)
          .join("\n")
      : "  (No scheduled classes found)";

  const diffsText =
    weeklyGymStore?.diffs && weeklyGymStore.diffs.length > 0
      ? weeklyGymStore.diffs
          .map((d) => `  * [${d.type}] Slot [${d.slotId}] - ${d.title} on ${d.date} original time: ${d.originalTime}`)
          .join("\n")
      : "  (No class changes/cancellations detected)";

  const currentPlanText = currentPlanDoc
    ? currentPlanDoc.plan
        .map((p) => {
          const exercisesStr = p.exercises
            .map(
              (e) =>
                `    - ${e.name} ${e.sets}x${e.reps} @ ${e.targetWeight || "?"} ${e.unit} (RPE ${e.targetRpe || "N/A"})${
                  e.supersetGroupId ? ` [Super: ${e.supersetGroupId}${e.orderInGroup || ""}]` : ""
                }`
            )
            .join("\n");
          return `  * ${p.date} (${p.day}) - ${p.focus} [${p.modality}] (Time: ${p.plannedTime})\n${exercisesStr}\n    Fuel: ${p.nutritionAdvice}`;
        })
        .join("\n")
    : "  (No active weekly plan found)";

  const systemPrompt = buildSystemPrompt({
    athleteState,
    gymScheduleSlots: slotsText,
    gymScheduleDiffs: diffsText,
    currentPlan: currentPlanText,
    currentDateIST,
  });

  // 4. Set up message queue
  const messages: LLMMessage[] = [
    { role: "system", parts: [{ text: systemPrompt }] },
    ...chatHistory,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const toolCallsExecuted: AgentResult["toolCallsExecuted"] = [];
  let loopCount = 0;
  const maxLoops = 5;
  let finalResponseText = "";

  while (loopCount < maxLoops) {
    loopCount++;

    const completionParams: {
      messages: LLMMessage[];
      tools?: LLMToolDefinition[];
      model?: string;
    } = { messages };

    if (toolsList) {
      completionParams.tools = toolsList;
    }
    if (model) {
      completionParams.model = model;
    }

    let text = "";
    let toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    if (!provider.generateCompletionStream) {
      throw new Error("Active LLM provider does not support completion streaming");
    }
    const generator = provider.generateCompletionStream(completionParams);
    for await (const chunk of generator) {
      if (chunk.text) {
        text += chunk.text;
        finalResponseText += chunk.text;
        onEvent({ type: "text", text: chunk.text });
      }
      if (chunk.toolCalls && chunk.toolCalls.length > 0) {
        toolCalls.push(...chunk.toolCalls);
      }
    }

    if (toolCalls.length > 0) {
      messages.push({
        role: "model",
        parts: toolCalls.map((tc) => ({
          functionCall: {
            name: tc.name,
            args: tc.args,
          },
        })),
      });

      const responseParts: LLMMessage["parts"] = [];

      for (const call of toolCalls) {
        onEvent({ type: "tool_start", name: call.name, args: call.args });

        let executionResult: string;
        try {
          if (call.name === "replan_week_schedule") {
            const args = ReplanWeekScheduleArgsSchema.parse(call.args);
            const fullPlan: WeeklyWorkoutPlan = {
              plan: args.plan,
              reasoning: args.reasoning,
              updatedAt: nowIST(),
            };
            await saveWeeklyWorkoutPlan(userId, isoWeekId, fullPlan);

            // Clear schedule diffs once a plan has been updated/synced to resolve notification banner
            const storeKey = scheduleWeekKey(isoWeekId);
            const store = await getWeeklyStore(storeKey);
            if (store) {
              store.diffs = [];
              await saveWeeklyStore(storeKey, store);
            }

            executionResult = JSON.stringify({
              success: true,
              message: "Weekly plan successfully generated/updated and saved to Redis.",
            });
          } else if (call.name === "log_lift_performance") {
            const args = LogLiftPerformanceArgsSchema.parse(call.args);
            athleteState.lifts.push({
              date: args.date,
              exerciseName: args.exerciseName,
              sets: args.sets.map((s) => ({
                setNumber: s.setNumber,
                weight: s.weight,
                unit: args.unit,
                repsCompleted: s.repsCompleted,
                rpe: s.rpe,
              })),
              notes: args.notes,
            });
            await saveAthleteState(userId, athleteState);
            executionResult = JSON.stringify({
              success: true,
              message: `Lifting performance for "${args.exerciseName}" logged.`,
            });
          } else if (call.name === "log_athlete_event") {
            const args = LogAthleteEventArgsSchema.parse(call.args);
            athleteState.events.push({
              date: args.date,
              type: args.type,
              severity: args.severity,
              notes: args.notes,
            });
            await saveAthleteState(userId, athleteState);
            executionResult = JSON.stringify({
              success: true,
              message: `Event [${args.type}] logged. Coach will auto-regulate intensity/planning.`,
            });
          } else {
            executionResult = JSON.stringify({
              error: `Unknown tool: ${call.name}`,
            });
          }
        } catch (err: any) {
          executionResult = JSON.stringify({
            error: err.message || "Failed to execute tool",
          });
        }

        toolCallsExecuted.push({
          name: call.name,
          args: call.args,
          result: executionResult,
        });

        onEvent({ type: "tool_end", name: call.name, result: executionResult });

        responseParts.push({
          functionResponse: {
            name: call.name,
            response: JSON.parse(executionResult),
          },
        });
      }

      messages.push({
        role: "user",
        parts: responseParts,
      });
    } else {
      return {
        text: finalResponseText || "No response text generated.",
        toolCallsExecuted,
      };
    }
  }

  throw new Error("Coach agent execution exceeded maximum tool calling loops.");
}
