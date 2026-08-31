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
  getDefaultLLMProvider,
} from "@/lib/llm-provider";
import {
  ReplanWeekScheduleArgsSchema,
  LogLiftPerformanceArgsSchema,
  LogAthleteEventArgsSchema,
  type AthleteState,
  type WeeklyWorkoutPlan,
} from "@/types/agent";

function safeParseJSON(str: string): any {
  if (typeof str !== "string") return str;
  let cleaned = str
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/"\s*:\s*/g, '":');
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// 1. Tool Declarations
// ---------------------------------------------------------------------------

export const replanWeekScheduleTool: LLMToolDefinition = {
  name: "replan_week_schedule",
  description:
    "Generates or modifies the weekly 7-day athletic workout and recovery plan with progressive overload targets, supersets, and nutrition advice based on available gym classes and athlete profile constraints.",
  parameters: {
    type: "object",
    properties: {
      plan: {
        type: "array",
        description: "The 7-day plan from Monday through Sunday.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD format (IST)" },
            day: { type: "string", description: "Monday, Tuesday, etc." },
            focus: {
              type: "string",
              description:
                'Primary session objective (e.g., "BJJ + Grip Conditioning", "Upper Hypertrophy (Supersets)")',
            },
            modality: {
              type: "string",
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
              type: "boolean",
              description: "True if mapped to a scheduled gym class",
            },
            gymSlotId: {
              type: "string",
              description: "Slot ID from gym schedule if isGymClass is true",
              nullable: true,
            },
            plannedTime: { type: "string", description: "HH:mm (24-hr IST)" },
            estimatedDurationMinutes: { type: "number", nullable: true },
            exercises: {
              type: "array",
              description:
                "Prescribed exercises with progressive overload targets and optional superset groupings.",
              items: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: 'e.g. "Barbell Bench Press", "Dumbbell Row"',
                  },
                  sets: { type: "number", description: "Number of working sets" },
                  reps: {
                    type: "string",
                    description: 'Target rep scheme (e.g. "5", "8-10", "AMRAP")',
                  },
                  targetWeight: {
                    type: "number",
                    description: "Legacy target weight (optional)",
                    nullable: true,
                  },
                  unit: { type: "string", enum: ["KG", "LBS"], nullable: true },
                  weightKg: {
                    type: "number",
                    description: "Prescribed weight in kilograms (e.g. 20, 22.5, 45, or null if bodyweight)",
                    nullable: true,
                  },
                  weightLbs: {
                    type: "number",
                    description: "Prescribed weight in pounds. MUST be rounded to standard 5 lbs increments (e.g. 45, 50, 90, or null if bodyweight). Do not output decimals for LBS (e.g. use 45 instead of 44.1).",
                    nullable: true,
                  },
                  targetRpe: {
                    type: "number",
                    description: "Target RPE (1-10 scale)",
                    nullable: true,
                  },
                  restSeconds: {
                    type: "number",
                    description: "Rest period in seconds after this set/exercise",
                  },
                  supersetGroupId: {
                    type: "string",
                    description:
                      'Short identifier like "A" or "B" for exercises done back-to-back. Null if standalone.',
                    nullable: true,
                  },
                  orderInGroup: {
                    type: "number",
                    description:
                      "Order within the superset (e.g. 1 for A1, 2 for A2)",
                    nullable: true,
                  },
                  progressionNote: {
                    type: "string",
                    description:
                      'Progression directive (e.g. "+5 lbs over last week"). ALWAYS specify progress targets in both KG and LBS (e.g. "+1 kg / +2.5 lbs")',
                    nullable: true,
                  },
                },
                required: ["name", "sets", "reps", "restSeconds"],
              },
            },
            nutritionAdvice: {
              type: "string",
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
        type: "string",
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
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD (IST)" },
      exerciseName: {
        type: "string",
        description: "Exercise name matching standard movement library",
      },
      unit: { type: "string", enum: ["KG", "LBS"] },
      sets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            setNumber: { type: "number" },
            weight: { type: "number" },
            repsCompleted: { type: "number" },
            rpe: { type: "number", nullable: true },
          },
          required: ["setNumber", "weight", "repsCompleted"],
        },
      },
      notes: {
        type: "string",
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
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD IST" },
      type: {
        type: "string",
        enum: ["ILLNESS", "MISSED_SESSION", "SORENESS_OVERLOAD", "TRAVEL_WORK"],
      },
      severity: { type: "string", enum: ["MILD", "MODERATE", "SEVERE"] },
      notes: { type: "string", description: "Details reported by user." },
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

  return `You are GymFlow Coach, an elite MMA & S&C head coach. Be direct, athletic, and actionable. Avoid fluff.

GROUND RULES:
1. Schedule class activities matching valid Gym Timetable slots.
2. Timetable Sync: If timetable slots list is empty, respond with "unpublished", call tool to build a baseline open strength/conditioning split, and tell user to run 'Sync Gym Schedule' when published.
3. WFO/WFH Work Constraint: Work hours are ${profile.workDayStartTime ?? "09:00"}-${profile.workDayEndTime ?? "18:00"}. Never schedule sessions inside this window. Training preference: ${profile.trainingTimePreference ?? "BOTH"}.
   - WFO Days: Session earliest start = workEnd + commute. Evening only.
   - WFH Days: Session earliest start = workEnd.
   - Morning sessions before (workStart - commute) for WFO, or workStart for WFH. Respect training preference window.
4. Tool Usage: Do not modify plan or log lifts/events in plain text. Call 'replan_week_schedule' exactly once to update the weekly plan. Max 2 tool steps total.
5. Saturday can only be morning sessions, only if weekday missed. Sunday is strictly REST.
6. Replace cancelled combat sessions (BJJ/KB) with KB/Boxing/DUT/TRX conditioning or S&C to maintain the 5-day training goal.
7. Focus on a brief coaching explanation in the response. Do not render calendar grids or markdown tables.

PERIODIZATION & SAFETY RULES:
1. Lock 2 combat slots (Kickboxing, BJJ) first from verified timetable slots.
2. Energy allocation: WFH = high demand (Heavy compounds, sparring); WFO = shorter/dense (TRX, boxing conditioning, antagonistic supersets e.g. Push+Pull) or REST.
3. Progressions: Compound lifts: linear load (+2.5kg/+5lbs) when RPE target is met. Accessories: double progression. Specify numeric targetWeight (estimate 15-20% body weight baseline if no history).
4. Auto-Regulation: Illness/fever/pain reports require REST/mobility recovery. Convert current and next day (min 48h rest) to REST/MOBILITY_RECOVERY.
5. No heavy compounds within 12h before or immediately after high-intensity combat sparring. RPE <= 7.5 on S&C after sparring.
6. Nutrition: Training days = 40-60g pre-workout carbs (90-120m prior), electrolytes, 35-40g post-workout protein. Rest days = baseline protein (4x30g meals).

CURRENT DATE/TIME IST: ${params.currentDateIST}

ATHLETE PROFILE:
- Weight: ${profile.weightKg ?? 70} kg. Preference: ${(profile as any).weightUnitPreference ?? (profile as any).unitPreference ?? "KG"}
- Height: ${profile.heightCm ?? 170} cm. Target Days/Week: ${profile.targetDaysPerWeek ?? 5}
- Mandatory Combat: Kickboxing: ${profile.mandatoryCombatSessions?.kickboxing ?? 0}/wk, BJJ: ${profile.mandatoryCombatSessions?.bjj ?? 0}/wk
- Diet: ${profile.dietaryPreference ?? "BALANCED"}. Protein Target: ${profile.targetDailyProteinGrams ?? 125}g
- Work: ${profile.workDayStartTime ?? "09:00"}-${profile.workDayEndTime ?? "18:00"}. Preference: ${profile.trainingTimePreference ?? "BOTH"}
- Work Mode/Commute: ${Object.entries((profile as any).weeklyWorkSchedule ?? (profile as any).workSchedule ?? {}).map(([day, s]) => `${day}: ${(s as any).mode} (${(s as any).commuteMinutesOneWay}m commute)`).join(", ")}

LIFT HISTORY BASES (Last 3):
${(params.athleteState.lifts || []).slice(-3).map((l) => `* ${l.date} - ${l.exerciseName}: [${l.sets.map((s) => `${s.setNumber}: ${s.weight}${s.unit} x ${s.repsCompleted} (RPE ${s.rpe ?? "N/A"})`).join(", ")}]`).join("\n")}

ATHLETE EVENTS (Last 2):
${(params.athleteState.events || []).slice(-2).map((e) => `* ${e.date} [${e.type}] Severity: ${e.severity}. Details: ${e.notes}`).join("\n")}

GYM TIMETABLE SLOTS:
${params.gymScheduleSlots}

GYM TIMETABLE DIFF ALERTS:
${params.gymScheduleDiffs}

ACTIVE WEEK PLAN:
${params.currentPlan}

Output concise, minified JSON for tool arguments. Do not include markdown commentary, extra whitespace, or redundant explanation fields inside tool payloads.
When invoking tools, output strictly valid, minified JSON arguments. Do not generate verbose reasoning blocks, unnecessary explanatory fields, or redundant un-modified days.
CRITICAL: Keep internal step-by-step reasoning concise (under 200 words). Do not reconstruct entire timetables or enumerate full schedule lists in your thinking trace. Determine the swap and invoke \`replan_week_schedule\` immediately.

Output Style: Write user-facing explanations in clear, polished, and professional language. Never leak internal variable names, unclosed parentheses, or corrupted transitions. Proofread coaching advice for grammatical coherence before emitting text.
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
  const athleteState = await getAthleteState(userId);
  let [weeklyGymStore, currentPlanDoc] = await Promise.all([
    getWeeklyStore(scheduleStoreKey),
    getWeeklyWorkoutPlan(userId, isoWeekId),
  ]);

  if (!athleteState) {
    throw new Error(`Athlete profile/state not found for user: ${userId}`);
  }

  // 3. Set up message queue
  const messages: LLMMessage[] = [
    { role: "system", parts: [{ text: "" }] }, // Placeholder, rebuilt below
    ...chatHistory,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  // Filter gym timetable slots to upcoming/active window only
  const filteredSlots = (weeklyGymStore?.slots || []).filter((s) => {
    const slotDateTime = `${s.date}T${s.startTime}`;
    if (slotDateTime < currentDateIST) return false;
    const startHour = s.startTime;
    const pref = athleteState.profile.trainingTimePreference || "BOTH";
    const slotDateObj = new Date(s.date);
    const dayName = slotDateObj.toLocaleDateString("en-US", { weekday: "long" });
    const isWeekend = dayName === "Saturday" || dayName === "Sunday";
    if (isWeekend) {
      if (pref === "EVENING") return startHour >= "12:00";
      if (pref === "MORNING") return startHour < "12:00";
      return true;
    }
    const workStart = athleteState.profile.workDayStartTime || "09:00";
    if (pref === "EVENING") {
      return startHour >= "17:30";
    } else if (pref === "MORNING") {
      return startHour < workStart;
    } else {
      return startHour < workStart || startHour >= "17:30";
    }
  });

  const slotsText =
    filteredSlots.length > 0
      ? filteredSlots
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

  messages[0] = { role: "system", parts: [{ text: systemPrompt }] };

  const toolCallsExecuted: AgentResult["toolCallsExecuted"] = [];

  // Phase 1: Tool Execution Turn (Non-Streaming)
  const completion = await provider.generateCompletion({
    messages,
    tools: toolsList,
    model,
    temperature: 0.2,
    maxTokens: 8192,
  });

  if (completion.toolCalls && completion.toolCalls.length > 0) {
    messages.push({
      role: "model",
      parts: completion.toolCalls.map((tc) => ({
        functionCall: {
          name: tc.name,
          args: tc.args,
        },
      })),
    });

    const responseParts: LLMMessage["parts"] = [];

    for (const call of completion.toolCalls) {
      let executionResult: string;
      try {
        if (call.name === "replan_week_schedule") {
          let args = call.args;
          if (typeof args.plan === "string") {
            try {
              args = {
                ...args,
                plan: safeParseJSON(args.plan),
              };
            } catch (e) {
              console.error("Failed to parse double-stringified plan in runCoachAgent:", e);
            }
          }
          const parsedArgs = ReplanWeekScheduleArgsSchema.parse(args);
          const fullPlan: WeeklyWorkoutPlan = {
            plan: parsedArgs.plan,
            reasoning: parsedArgs.reasoning,
            updatedAt: nowIST(),
          };
          await saveWeeklyWorkoutPlan(userId, isoWeekId, fullPlan);
          currentPlanDoc = fullPlan;

          const storeKey = scheduleWeekKey(isoWeekId);
          const store = await getWeeklyStore(storeKey);
          if (store) {
            store.diffs = [];
            await saveWeeklyStore(storeKey, store);
            weeklyGymStore = store;
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
        console.error(`[TOOL_ERROR] ${call.name}`, err);
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

    messages.push({
      role: "user",
      parts: responseParts,
    });

    const followUp = await provider.generateCompletion({
      messages,
      model,
    });

    return {
      text: followUp.text || "No response text generated.",
      toolCallsExecuted,
    };
  } else {
    return {
      text: completion.text || "No response text generated.",
      toolCallsExecuted,
    };
  }
}

export async function runCoachAgentStream(params: {
  userId: string;
  userMessage: string;
  chatHistory?: LLMMessage[];
  provider?: LLMProvider;
  model?: string;
  controller?: any;
  onToken?: (token: string) => void;
  onEvent: (event: {
    type: "text" | "tool_start" | "tool_end";
    text?: string;
    name?: string;
    args?: Record<string, unknown>;
    result?: string;
  }) => void;
}): Promise<AgentResult> {
  const { userId, userMessage, chatHistory = [], model, controller, onToken, onEvent } = params;
  const provider = params.provider || getDefaultLLMProvider();

  // 1. Resolve current week and dates
  const now = new Date();
  const isoWeekId = weekKey(now);
  const currentDateIST = nowISTDateTime();

  // 2. Fetch state in parallel from Redis
  const scheduleStoreKey = scheduleWeekKey(isoWeekId);
  const athleteState = await getAthleteState(userId);
  let [weeklyGymStore, currentPlanDoc] = await Promise.all([
    getWeeklyStore(scheduleStoreKey),
    getWeeklyWorkoutPlan(userId, isoWeekId),
  ]);

  if (!athleteState) {
    throw new Error(`Athlete profile/state not found for user: ${userId}`);
  }

  // 3. Set up message queue
  const messages: LLMMessage[] = [
    { role: "system", parts: [{ text: "" }] }, // Placeholder, rebuilt below
    ...chatHistory,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  // Filter gym timetable slots to upcoming/active window only
  const filteredSlots = (weeklyGymStore?.slots || []).filter((s) => {
    const slotDateTime = `${s.date}T${s.startTime}`;
    if (slotDateTime < currentDateIST) return false;
    const startHour = s.startTime;
    const pref = athleteState.profile.trainingTimePreference || "BOTH";
    const slotDateObj = new Date(s.date);
    const dayName = slotDateObj.toLocaleDateString("en-US", { weekday: "long" });
    const isWeekend = dayName === "Saturday" || dayName === "Sunday";
    if (isWeekend) {
      if (pref === "EVENING") return startHour >= "12:00";
      if (pref === "MORNING") return startHour < "12:00";
      return true;
    }
    const workStart = athleteState.profile.workDayStartTime || "09:00";
    if (pref === "EVENING") {
      return startHour >= "17:30";
    } else if (pref === "MORNING") {
      return startHour < workStart;
    } else {
      return startHour < workStart || startHour >= "17:30";
    }
  });

  const slotsText =
    filteredSlots.length > 0
      ? filteredSlots
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

  messages[0] = { role: "system", parts: [{ text: systemPrompt }] };

  const toolCallsExecuted: AgentResult["toolCallsExecuted"] = [];

  const isReplanning = /replan|schedule|change|update|swap|calendar|class|cancel|sync|workout plan|generate/i.test(userMessage);
  const toolChoice = isReplanning ? {
    type: "function",
    function: { name: "replan_week_schedule" }
  } : undefined;

  // Phase 1: Tool Execution Turn (Streaming & Accumulate)
  if (!provider.generateCompletionStream) {
    throw new Error("Active LLM provider does not support completion streaming");
  }

  const completionParams = {
    messages,
    tools: toolsList,
    model,
    temperature: 0.2,
    maxTokens: 8192, // Increased to 8192 to support reasoning models where reasoning tokens count against the limit
    toolChoice,
  };

  const generator = provider.generateCompletionStream(completionParams);
  let toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }> = [];
  let directText = "";

  for await (const chunk of generator) {
    if (chunk.text) {
      directText += chunk.text;
      if (onToken) {
        onToken(chunk.text);
      }
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

    for (const call of toolCalls) {
      const id = call.id || `call_fallback_${call.name}`;
      if (controller) {
        const statusMsg = call.name === 'replan_week_schedule' 
          ? 'Updating your 7-day training schedule...' 
          : `Checking ${call.name.replace(/_/g, ' ')}...`;

        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ type: 'status', message: statusMsg })}\n\n`)
        );
      }

      onEvent({ type: "tool_start", name: call.name, args: call.args });

      let executionResult: string;
      let toolTimeoutId: any;
      try {
        const executeToolPromise = async () => {
          if (call.name === "replan_week_schedule") {
            let args = call.args;
            if (typeof args.plan === "string") {
              try {
                args = {
                  ...args,
                  plan: safeParseJSON(args.plan),
                };
              } catch (e) {
                console.error("Failed to parse double-stringified plan in runCoachAgentStream:", e);
              }
            }
            const parsedArgs = ReplanWeekScheduleArgsSchema.parse(args);
            const fullPlan: WeeklyWorkoutPlan = {
              plan: parsedArgs.plan,
              reasoning: parsedArgs.reasoning,
              updatedAt: nowIST(),
            };
            await saveWeeklyWorkoutPlan(userId, isoWeekId, fullPlan);
            currentPlanDoc = fullPlan;

            const storeKey = scheduleWeekKey(isoWeekId);
            const store = await getWeeklyStore(storeKey);
            if (store) {
              store.diffs = [];
              await saveWeeklyStore(storeKey, store);
              weeklyGymStore = store;
            }

            return JSON.stringify({
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
            return JSON.stringify({
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
            return JSON.stringify({
              success: true,
              message: `Event [${args.type}] logged. Coach will auto-regulate intensity/planning.`,
            });
          } else {
            return JSON.stringify({
              error: `Unknown tool: ${call.name}`,
            });
          }
        };

        executionResult = await Promise.race([
          executeToolPromise(),
          new Promise<string>((_, reject) => {
            toolTimeoutId = setTimeout(() => reject(new Error(`Tool ${call.name} timed out after 10s`)), 10000);
          })
        ]);
      } catch (err: any) {
        console.error(`[AGENT_TOOL_ERROR] Error executing tool ${call.name}:`, err.stack || err.message || err);
        executionResult = JSON.stringify({
          error: err.message || "Failed to execute tool",
        });
      } finally {
        if (toolTimeoutId) {
          clearTimeout(toolTimeoutId);
        }
      }

      toolCallsExecuted.push({
        name: call.name,
        args: call.args,
        result: executionResult,
      });

      onEvent({ type: "tool_end", name: call.name, result: executionResult });

      messages.push({
        role: "tool",
        tool_call_id: id,
        content: executionResult,
      });
    }

    if (controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify({ type: 'status', message: 'Generating explanation...' })}\n\n`)
      );
    }

    let rationaleText = "";
    const followUpGenerator = provider.generateCompletionStream({
      messages,
      model,
    });

    for await (const chunk of followUpGenerator) {
      if (chunk.text) {
        rationaleText += chunk.text;
        if (onToken) {
          onToken(chunk.text);
        }
        onEvent({ type: "text", text: chunk.text });
      }
    }

    return {
      text: rationaleText,
      toolCallsExecuted,
    };
  } else {
    return {
      text: directText,
      toolCallsExecuted,
    };
  }
}

