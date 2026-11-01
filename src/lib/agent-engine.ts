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
import { nowIST, nowISTDateTime, getOrSyncWeeklySchedule } from "@/lib/schedule-service";
import {
  type LLMMessage,
  type LLMToolDefinition,
  type LLMProvider,
  getDefaultLLMProvider,
} from "@/lib/llm-provider";
import {
  LogLiftPerformanceArgsSchema,
  LogAthleteEventArgsSchema,
  type AthleteState,
  type DailyWorkoutPlan,
  type WeeklyWorkoutPlan,
  getDefaultAthleteState,
} from "@/types/agent";

import { safeParseJSON } from "@/lib/json-utils";
import {
  generateDeterministicWeekPlan,
  validateAndRepairWeeklyPlan,
  filterGymSlotsByCommuteAndPreferences,
  getPlanningWeekKey,
  getWeekDaysForDate,
} from "@/lib/deterministic-planner";

// ---------------------------------------------------------------------------
// 1. Tool Declarations
// ---------------------------------------------------------------------------

export const replanWeekScheduleTool: LLMToolDefinition = {
  name: "replan_week_schedule",
  description:
    "Invokes the deterministic planner to solve, adjust, or generate the verified weekly 7-day athletic workout and recovery plan. All timetable slot matching, commute buffers, progressive overload, and recovery rules are computed deterministically with 100% precision.",
  parameters: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "Clear coaching explanation of why this split was selected given the work schedule, fatigue, and gym timetable.",
      },
      plan: {
        type: "array",
        description: "Optional 7-day plan overrides from Monday through Sunday if specific day modifications were requested.",
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
              description: "True if mapped to a scheduled gym class. For class sessions (isGymClass: true), exercises array MUST strictly contain only Warmup and Cooldown recommendations without superset exercise pairs.",
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
                "Prescribed exercises with progressive overload targets. For scheduled gym classes (isGymClass: true), strictly list ONLY Warmup and Cooldown/Mobility routines with supersetGroupId set to null.",
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
    },
    required: ["reasoning"],
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
// 1b. Helper Functions: Raw JSON Fallback
// ---------------------------------------------------------------------------

async function handleRawJSONFallback(
  rawText: string,
  userId: string,
  isoWeekId: string,
  currentPlanDoc: WeeklyWorkoutPlan | null,
  currentDateIST: string,
  toolCallsExecuted: AgentResult["toolCallsExecuted"],
  athleteState?: AthleteState,
  weeklyGymStoreSlots?: any[],
  userMessage?: string
): Promise<{ text: string }> {
  if (!rawText && !athleteState) return { text: "No response text generated." };

  const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```|(\{\s*"plan"\s*:\s*\[[\s\S]*?\}\s*)/gi;
  let match: RegExpExecArray | null;
  let interceptedPlan: WeeklyWorkoutPlan | null = null;
  let cleanText = (rawText || "")
    .replace(/<[|｜]?(?:channel|thought|end_thought)[|｜]?>/gi, "")
    .replace(/<channel[|｜]?>/gi, "")
    .replace(/<[|｜]?channel>/gi, "")
    .replace(/<[|｜]?(?:DSML[|｜]?)?tool_calls[\s\S]*?(?:<\/[|｜]?(?:DSML[|｜]?)?tool_calls[|｜]?>|$)/gi, "")
    .replace(/<[|｜]?tool_call[|｜]?>[\s\S]*?(?:<\/[|｜]?tool_call[|｜]?>|$)/gi, "")
    .replace(/call:[a-zA-Z0-9_]+\s*\{[\s\S]*?\}/gi, "")
    .replace(/^thought\b[\s\S]*?(?=(?:call:|\n\n[A-Z]|$))/gi, "")
    .trim();

  while ((match = jsonBlockRegex.exec(rawText || "")) !== null) {
    const candidate = (match[1] || match[2] || "").trim();
    try {
      const parsed = safeParseJSON(candidate);
      if (parsed && Array.isArray(parsed.plan)) {
        const sanitizedPlan = athleteState
          ? validateAndRepairWeeklyPlan(
              parsed.plan,
              athleteState,
              currentDateIST,
              currentPlanDoc,
              weeklyGymStoreSlots
            )
          : parsed.plan;

        interceptedPlan = {
          plan: sanitizedPlan,
          reasoning: parsed.reasoning || "Weekly workout plan updated based on schedule constraints.",
          updatedAt: nowIST(),
        };

        cleanText = cleanText.replace(match[0], "").trim();
        break;
      }
    } catch {
      // Continue searching
    }
  }

  // If no JSON tool call or block was found, check if planning intent is present
  const isPlanningIntent = /replan|schedule|workout plan|generate my training|weekly plan|training plan|swap|switch|replace|cancel|cannot attend|can't attend|not for|youth|skip/i.test(userMessage || "");
  if (!interceptedPlan && athleteState && (isPlanningIntent || !cleanText)) {
    interceptedPlan = generateDeterministicWeekPlan({
      athleteState,
      weeklyGymStoreSlots: weeklyGymStoreSlots || [],
      currentPlan: currentPlanDoc,
      currentDateIST,
    });
  }

  if (interceptedPlan) {
    await saveWeeklyWorkoutPlan(userId, isoWeekId, interceptedPlan);
    const storeKey = scheduleWeekKey(isoWeekId);
    const store = await getWeeklyStore(storeKey);
    if (store) {
      store.diffs = [];
      await saveWeeklyStore(storeKey, store);
    }

    toolCallsExecuted.push({
      name: "replan_week_schedule",
      args: { plan: interceptedPlan.plan, reasoning: interceptedPlan.reasoning },
      result: JSON.stringify({
        success: true,
        message: "Weekly plan successfully updated with 100% constraint compliance.",
      }),
    });

    if (interceptedPlan.reasoning && !cleanText) {
      cleanText = interceptedPlan.reasoning;
    } else if (!cleanText) {
      let scheduleSummary = `📅 **Updated 7-Day Athletic Plan (${interceptedPlan.plan[0]?.date || ""} – ${interceptedPlan.plan[interceptedPlan.plan.length - 1]?.date || ""})**\n\n`;
      for (const day of interceptedPlan.plan) {
        const icon = day.modality === "REST" ? "🛌" : day.modality === "KICKBOXING" || day.modality === "BJJ" ? "🥊" : "🏋️‍♂️";
        const timeStr = day.modality !== "REST" ? ` @ ${day.plannedTime}` : "";
        const classTag = day.isGymClass ? " (Gym Class)" : "";
        scheduleSummary += `* ${icon} **${day.day}** (${day.date}): **${day.focus}**${timeStr}${classTag}\n`;
      }
      if (interceptedPlan.reasoning) {
        scheduleSummary += `\n**Coach Rationale:** ${interceptedPlan.reasoning}\n`;
      }
      cleanText = scheduleSummary;
    }
  }

  return { text: cleanText };
}

// ---------------------------------------------------------------------------
// 2. System Prompt Builder
// ---------------------------------------------------------------------------

export function buildSystemPrompt(params: {
  athleteState: AthleteState;
  gymScheduleSlots?: string; // pre-formatted compact string
  gymScheduleDiffs?: string; // pre-formatted compact string
  currentPlan: string; // pre-formatted current plan
  currentDateIST: string;
  weeklyCalendarAnchor?: string;
}): string {
  const profile = params.athleteState.profile;

  return `You are GymFlow Coach, an elite MMA & S&C head coach. All scheduling, timetable matching, commute constraints, and weight progression are handled strictly by the deterministic planner tool. Do not calculate times or invent slots yourself. If a schedule needs modification, formulate the parameters and invoke the planner tool.

GROUND RULES:
1. Tool Usage: All scheduling, timetable matching, commute constraints, and weight progression are handled strictly by the deterministic planner tool. When a schedule needs to be created, synced, or replanned (e.g. after a missed workout, gym sync, or user request), call 'replan_week_schedule' directly using native function tool calls with your coaching 'reasoning' (and optional 'missedDate'). The deterministic planner tool will automatically compute the 100% constraint-compliant 7-day plan from verified timetable classes. Do not calculate times or invent slots yourself.
2. Timetable Sync: If timetable slots list is empty, respond with "unpublished", call tool to build a baseline open strength/conditioning split, and tell user to run 'Sync Gym Schedule' when published.
3. Replace cancelled combat sessions (BJJ/KB) with KB/Boxing conditioning or S&C to maintain the ${profile.targetDaysPerWeek ?? 5}-day training goal.
4. Focus on a brief coaching explanation in the response. Do not render calendar grids or markdown tables.
5. MODALITY ENUM ENFORCEMENT: The only allowable modalities for activities are: ${(profile.modalities ?? []).join(", ")}. Never use MUAY_THAI, MMA, or any unconfigured modality. Combat sessions MUST strictly be labeled KICKBOXING or BJJ.
6. MANDATORY COMBAT CAPS: Exactly ${profile.mandatoryCombatSessions?.kickboxing ?? 1} Kickboxing and ${profile.mandatoryCombatSessions?.bjj ?? 1} BJJ session(s) per week. NEVER schedule extra combat sessions.
7. PAST DAYS ARE LOCKED: Current date is ${params.currentDateIST.split("T")[0] || ""}. Any schedule days prior to today have already been completed and are locked by the deterministic planner tool.
8. SCHEDULED GYM CLASSES: All gym class sessions are strictly matched by the deterministic planner tool from verified timetable slots. Do NOT invent gym classes, times, or slots.
9. REPORTING ACCURACY: 
   - You may ONLY refer to gym classes listed in VERIFIED AVAILABLE GYM CLASSES. Absolutely NEVER invent, guess, or assume gym classes, days, or times that are not in this list. If no class exists for a modality or day, state that truthfully.
   - When the user asks about the schedule, you must strictly and accurately reflect the ACTIVE WEEK PLAN without hallucinating conflicting days, extra combat sessions, or illegal times.
   - SUNDAY IS STRICTLY REST: Absolutely NEVER suggest, schedule, or move workouts to Sunday.

PERIODIZATION & COACHING GUIDELINES:
1. Energy allocation: WFH = high demand (Heavy compounds, sparring); WFO = shorter/dense (boxing conditioning, antagonistic supersets e.g. Push+Pull) or REST.
2. Progressions: Compound lifts: linear load (+2.5kg/+5lbs) when RPE target is met. Accessories: double progression.
3. Auto-Regulation: Illness/fever/pain/missed session reports require REST/mobility recovery or compensatory conditioning. Convert current and next day (min 48h rest) to REST/MOBILITY_RECOVERY when sick.
4. Nutrition: Training days = 40-60g pre-workout carbs (90-120m prior), electrolytes, 35-40g post-workout protein. Rest days = baseline protein (4x30g meals).

CURRENT DATE/TIME IST: ${params.currentDateIST}

${params.weeklyCalendarAnchor ? `TARGET WEEK CALENDAR ANCHOR (Strict Reference):
${params.weeklyCalendarAnchor}

` : ""}ATHLETE PROFILE:
- Weight: ${profile.weightKg ?? 70} kg. Preference: ${(profile as any).weightUnitPreference ?? (profile as any).unitPreference ?? "KG"}
- Height: ${profile.heightCm ?? 170} cm. Target Days/Week: ${profile.targetDaysPerWeek ?? 5}
- Mandatory Combat: Kickboxing: ${profile.mandatoryCombatSessions?.kickboxing ?? 0}/wk, BJJ: ${profile.mandatoryCombatSessions?.bjj ?? 0}/wk
- Active Modalities: ${(profile.modalities ?? []).join(", ")}
- Diet: ${profile.dietaryPreference ?? "BALANCED"}. Protein Target: ${profile.targetDailyProteinGrams ?? 125}g
- Work: ${profile.workDayStartTime ?? "09:00"}-${profile.workDayEndTime ?? "18:00"}. Preference: ${profile.trainingTimePreference ?? "BOTH"}
- Hard Stop Cutoff: ${profile.hardStopTrainingTime ?? "20:00"} (Window: ${profile.hardStopWindow ?? "EVENING"})
- Work Mode/Commute: ${Object.entries((profile as any).weeklyWorkSchedule ?? (profile as any).workSchedule ?? {}).map(([day, s]) => `${day}: ${(s as any).mode} (${(s as any).commuteMinutesOneWay}m commute)`).join(", ")}

LIFT HISTORY BASES (Last 3):
${(params.athleteState.lifts || []).slice(-3).map((l) => `* ${l.date} - ${l.exerciseName}: [${l.sets.map((s) => `${s.setNumber}: ${s.weight}${s.unit} x ${s.repsCompleted} (RPE ${s.rpe ?? "N/A"})`).join(", ")}]`).join("\n")}

ATHLETE EVENTS (Last 2):
${(params.athleteState.events || []).slice(-2).map((e) => `* ${e.date} [${e.type}] Severity: ${e.severity}. Details: ${e.notes}`).join("\n")}
${params.gymScheduleSlots ? `
VERIFIED AVAILABLE GYM CLASSES:
${params.gymScheduleSlots}
` : ""}${params.gymScheduleDiffs ? `
GYM TIMETABLE DIFF ALERTS:
${params.gymScheduleDiffs}
` : ""}
ACTIVE WEEK PLAN:
${params.currentPlan}

INSTRUCTIONS:
1. Pass valid JSON parameters directly when making function tool calls.
2. Output Style: Write user-facing text in clear, natural markdown coaching tone. NEVER print raw JSON code blocks or tool arguments in your user-facing response text.
`;
}
// ---------------------------------------------------------------------------
// 3. Execution & Orchestration Loop
// ---------------------------------------------------------------------------

function buildWeeklyCalendarAnchor(currentDateIST: string, options?: { isNextWeek?: boolean }): string {
  const weekDays = getWeekDaysForDate(currentDateIST, options);
  return weekDays
    .map(
      (day) =>
        `  * ${day.dayName}: ${day.date}${day.isToday ? " [TODAY]" : ""}${day.isPast ? " [PAST]" : ""}`
    )
    .join("\n");
}

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

  // 1. Resolve current planning week and dates (accounting for Sunday or next week request)
  const currentDateIST = nowISTDateTime();
  const isNextWeek = /next\s*week|upcoming\s*week|next\s*7\s*days/i.test(userMessage);
  const isoWeekId = getPlanningWeekKey(currentDateIST, { isNextWeek });

  // 2. Fetch state in parallel from Redis
  const scheduleStoreKey = scheduleWeekKey(isoWeekId);
  let athleteState = await getAthleteState(userId);
  if (!athleteState) {
    athleteState = getDefaultAthleteState(userId);
    await saveAthleteState(userId, athleteState);
  }



  let [weeklyGymStore, currentPlanDoc] = await Promise.all([
    getWeeklyStore(scheduleStoreKey),
    getWeeklyWorkoutPlan(userId, isoWeekId),
  ]);

  if (!weeklyGymStore || /sync/i.test(userMessage)) {
    try {
      const syncResult = await getOrSyncWeeklySchedule(userId, {
        forceRefresh: /sync/i.test(userMessage),
        targetWeekId: isoWeekId,
      });
      weeklyGymStore = syncResult.store;
    } catch {
      // Best-effort sync
    }
  }

  // Ensure an active baseline plan exists in Redis if unpopulated
  if (!currentPlanDoc) {
    currentPlanDoc = generateDeterministicWeekPlan({
      athleteState,
      weeklyGymStoreSlots: weeklyGymStore?.slots || [],
      currentDateIST,
      isNextWeek,
    });
    await saveWeeklyWorkoutPlan(userId, isoWeekId, currentPlanDoc);
  }

  // 3. Set up message queue
  const messages: LLMMessage[] = [
    { role: "system", parts: [{ text: "" }] }, // Placeholder, rebuilt below
    ...chatHistory,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  // Filter gym timetable slots using helper (training window & hard stop cutoff)
  const filteredSlots = filterGymSlotsByCommuteAndPreferences(weeklyGymStore?.slots || [], athleteState, currentDateIST);

  const slotsText =
    filteredSlots.length > 0
      ? filteredSlots
          .map((s) => {
            const dayOfWeek = s.dayOfWeek || new Date(`${s.date}T00:00:00+05:30`).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Kolkata" });
            return `  * Slot [${s.id}] - ${dayOfWeek} ${s.date} (${s.startTime}-${s.endTime}): ${s.title} by ${s.trainer}`;
          })
          .join("\n")
      : "  (No scheduled classes found matching constraints)";

  const diffsText =
    weeklyGymStore?.diffs && weeklyGymStore.diffs.length > 0
      ? weeklyGymStore.diffs
          .map((d) => `  * [${d.type}] Slot [${d.slotId}] - ${d.title} on ${d.date} original time: ${d.originalTime}`)
          .join("\n")
      : "";

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

  const weeklyCalendarAnchor = buildWeeklyCalendarAnchor(currentDateIST, { isNextWeek });

  const systemPrompt = buildSystemPrompt({
    athleteState,
    gymScheduleSlots: slotsText,
    gymScheduleDiffs: diffsText,
    currentPlan: currentPlanText,
    currentDateIST,
    weeklyCalendarAnchor,
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
          if (typeof args?.plan === "string") {
            try {
              args = {
                ...args,
                plan: safeParseJSON(args.plan),
              };
            } catch (e) {
              console.error("Failed to parse double-stringified plan in runCoachAgent:", e);
            }
          }



            let finalPlan: DailyWorkoutPlan[];
            if (args?.plan && Array.isArray(args.plan) && args.plan.length > 0) {
              finalPlan = validateAndRepairWeeklyPlan(
                args.plan,
                athleteState,
                currentDateIST,
                currentPlanDoc,
                weeklyGymStore?.slots || []
              );
            } else {
              const solvedPlanDoc = generateDeterministicWeekPlan({
                athleteState,
                weeklyGymStoreSlots: weeklyGymStore?.slots || [],
                diffs: weeklyGymStore?.diffs,
                currentPlan: currentPlanDoc,
                currentDateIST,
                isNextWeek,
              });
              finalPlan = solvedPlanDoc.plan;
            }

            const reasoning = typeof args?.reasoning === "string" && args.reasoning.trim()
              ? args.reasoning
              : "Weekly workout plan updated based on schedule constraints.";

            const fullPlan: WeeklyWorkoutPlan = {
              plan: finalPlan,
              reasoning,
              updatedAt: nowIST(),
            };

          call.args = { plan: fullPlan.plan, reasoning: fullPlan.reasoning };

          await saveWeeklyWorkoutPlan(userId, isoWeekId, fullPlan);
          currentPlanDoc = fullPlan;

          const storeKey = scheduleWeekKey(isoWeekId);
          const store = await getWeeklyStore(storeKey);
          if (store) {
            store.diffs = [];
            await saveWeeklyStore(storeKey, store);
            weeklyGymStore = store;
          }

          const scheduleSummary = fullPlan.plan
            .map((d) => `${d.day} (${d.date}): ${d.focus} @ ${d.plannedTime} [${d.modality}] (Class: ${d.isGymClass})`)
            .join("; ");

          executionResult = JSON.stringify({
            success: true,
            lockedSchedule: scheduleSummary,
            plan: fullPlan.plan,
            message: "Weekly plan successfully verified by deterministic planner and locked to Redis.",
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

    let returnText = followUp.text || "";
    if (!returnText.trim()) {
      if (currentPlanDoc) {
        let scheduleSummary = `📅 **Updated 7-Day Athletic Plan (${currentPlanDoc.plan[0]?.date || ""} – ${currentPlanDoc.plan[currentPlanDoc.plan.length - 1]?.date || ""})**\n\n`;
        for (const day of currentPlanDoc.plan) {
          const icon = day.modality === "REST" ? "🛌" : day.modality === "KICKBOXING" || day.modality === "BJJ" ? "🥊" : "🏋️‍♂️";
          const timeStr = day.modality !== "REST" ? ` @ ${day.plannedTime}` : "";
          const classTag = day.isGymClass ? " (Gym Class)" : "";
          scheduleSummary += `* ${icon} **${day.day}** (${day.date}): **${day.focus}**${timeStr}${classTag}\n`;
        }
        if (currentPlanDoc.reasoning) {
          scheduleSummary += `\n**Coach Rationale:** ${currentPlanDoc.reasoning}\n`;
        }
        returnText = scheduleSummary;
      }
    }

    return {
      text: returnText || "Your weekly schedule has been updated.",
      toolCallsExecuted,
    };
  } else {
    const fallbackResult = await handleRawJSONFallback(
      completion.text || "",
      userId,
      isoWeekId,
      currentPlanDoc,
      currentDateIST,
      toolCallsExecuted,
      athleteState,
      weeklyGymStore?.slots,
      userMessage
    );
    return {
      text: fallbackResult.text || "No response text generated.",
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

  // 1. Resolve current planning week and dates (accounting for Sunday or next week request)
  const currentDateIST = nowISTDateTime();
  const isNextWeek = /next\s*week|upcoming\s*week|next\s*7\s*days/i.test(userMessage);
  const isoWeekId = getPlanningWeekKey(currentDateIST, { isNextWeek });

  // 2. Fetch state in parallel from Redis
  const scheduleStoreKey = scheduleWeekKey(isoWeekId);
  let athleteState = await getAthleteState(userId);
  if (!athleteState) {
    athleteState = getDefaultAthleteState(userId);
    await saveAthleteState(userId, athleteState);
  }



  let [weeklyGymStore, currentPlanDoc] = await Promise.all([
    getWeeklyStore(scheduleStoreKey),
    getWeeklyWorkoutPlan(userId, isoWeekId),
  ]);

  if (!weeklyGymStore || /sync/i.test(userMessage)) {
    try {
      const syncResult = await getOrSyncWeeklySchedule(userId, {
        forceRefresh: /sync/i.test(userMessage),
        targetWeekId: isoWeekId,
      });
      weeklyGymStore = syncResult.store;
    } catch {
      // Best-effort sync
    }
  }

  // Ensure an active baseline plan exists in Redis if unpopulated
  if (!currentPlanDoc) {
    currentPlanDoc = generateDeterministicWeekPlan({
      athleteState,
      weeklyGymStoreSlots: weeklyGymStore?.slots || [],
      currentDateIST,
      isNextWeek,
    });
    await saveWeeklyWorkoutPlan(userId, isoWeekId, currentPlanDoc);
  }

  // 3. Set up message queue
  const messages: LLMMessage[] = [
    { role: "system", parts: [{ text: "" }] }, // Placeholder, rebuilt below
    ...chatHistory,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  // Filter gym timetable slots using helper (training window & hard stop cutoff)
  const filteredSlots = filterGymSlotsByCommuteAndPreferences(weeklyGymStore?.slots || [], athleteState, currentDateIST);

  const slotsText =
    filteredSlots.length > 0
      ? filteredSlots
          .map((s) => {
            const dayOfWeek = s.dayOfWeek || new Date(`${s.date}T00:00:00+05:30`).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Kolkata" });
            return `  * Slot [${s.id}] - ${dayOfWeek} ${s.date} (${s.startTime}-${s.endTime}): ${s.title} by ${s.trainer}`;
          })
          .join("\n")
      : "  (No scheduled classes found matching constraints)";

  const diffsText =
    weeklyGymStore?.diffs && weeklyGymStore.diffs.length > 0
      ? weeklyGymStore.diffs
          .map((d) => `  * [${d.type}] Slot [${d.slotId}] - ${d.title} on ${d.date} original time: ${d.originalTime}`)
          .join("\n")
      : "";

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

  const weeklyCalendarAnchor = buildWeeklyCalendarAnchor(currentDateIST, { isNextWeek });

  const systemPrompt = buildSystemPrompt({
    athleteState,
    gymScheduleSlots: slotsText,
    gymScheduleDiffs: diffsText,
    currentPlan: currentPlanText,
    currentDateIST,
    weeklyCalendarAnchor,
  });

  messages[0] = { role: "system", parts: [{ text: systemPrompt }] };

  const toolCallsExecuted: AgentResult["toolCallsExecuted"] = [];



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
      };

  const generator = provider.generateCompletionStream(completionParams);
  let toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }> = [];
  let directText = "";

  for await (const chunk of generator) {
    if (chunk.text) {
      directText += chunk.text;
    }
    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
      toolCalls.push(...chunk.toolCalls);
    }
  }

  // If no tool calls were made, stream the direct text response
  if (toolCalls.length === 0) {
    if (directText) {
      if (onToken) {
        onToken(directText);
      }
      onEvent({ type: "text", text: directText });
    }
  }

  if (toolCalls.length > 0) {
    messages.push({
      role: "model",
      parts: toolCalls.map((tc, idx) => ({
        functionCall: {
          name: tc.name,
          args: tc.args,
          id: tc.id || `call_0_${idx}`,
        },
      })),
    });

    for (let callIndex = 0; callIndex < toolCalls.length; callIndex++) {
      const call = toolCalls[callIndex]!;
      const id = call.id || `call_0_${callIndex}`;
      if (controller) {
        const statusMsg = call.name === 'replan_week_schedule' 
          ? 'Updating your 7-day training schedule...' 
          : `Checking ${call.name.replace(/_/g, ' ')}...`;

        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ type: 'status', message: statusMsg })}\n\n`)
        );
      }

      let toolArgs = call.args;
      if (call.name === "replan_week_schedule" && typeof toolArgs?.plan === "string") {
        try {
          toolArgs = {
            ...toolArgs,
            plan: safeParseJSON(toolArgs.plan),
          };
          call.args = toolArgs;
        } catch (e) {
          console.error("Failed to pre-parse stringified plan in runCoachAgentStream:", e);
        }
      }

      onEvent({ type: "tool_start", name: call.name, args: toolArgs });

      let executionResult: string;
      let toolTimeoutId: any;
      try {
        const executeToolPromise = async () => {
          if (call.name === "replan_week_schedule") {
            let args = call.args;
            if (typeof args?.plan === "string") {
              try {
                args = {
                  ...args,
                  plan: safeParseJSON(args.plan),
                };
              } catch (e) {
                console.error("Failed to parse double-stringified plan in runCoachAgentStream:", e);
              }
            }



            let finalPlan: DailyWorkoutPlan[];
            if (args?.plan && Array.isArray(args.plan) && args.plan.length > 0) {
              finalPlan = validateAndRepairWeeklyPlan(
                args.plan,
                athleteState,
                currentDateIST,
                currentPlanDoc,
                weeklyGymStore?.slots || []
              );
            } else {
              const solvedPlanDoc = generateDeterministicWeekPlan({
                athleteState,
                weeklyGymStoreSlots: weeklyGymStore?.slots || [],
                diffs: weeklyGymStore?.diffs,
                currentPlan: currentPlanDoc,
                currentDateIST,
                isNextWeek,
              });
              finalPlan = solvedPlanDoc.plan;
            }

            const reasoning = typeof args?.reasoning === "string" && args.reasoning.trim()
              ? args.reasoning
              : "Weekly workout plan updated based on schedule constraints.";

            const fullPlan: WeeklyWorkoutPlan = {
              plan: finalPlan,
              reasoning,
              updatedAt: nowIST(),
            };

            call.args = { plan: fullPlan.plan, reasoning: fullPlan.reasoning };

            await saveWeeklyWorkoutPlan(userId, isoWeekId, fullPlan);
            currentPlanDoc = fullPlan;

            const storeKey = scheduleWeekKey(isoWeekId);
            const store = await getWeeklyStore(storeKey);
            if (store) {
              store.diffs = [];
              await saveWeeklyStore(storeKey, store);
              weeklyGymStore = store;
            }

            const scheduleSummary = fullPlan.plan
              .map((d) => `${d.day} (${d.date}): ${d.focus} @ ${d.plannedTime} [${d.modality}] (Class: ${d.isGymClass})`)
              .join("; ");

            return JSON.stringify({
              success: true,
              lockedSchedule: scheduleSummary,
              plan: fullPlan.plan,
              message: "Weekly plan successfully validated and locked to Redis.",
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

    if (!rationaleText.trim()) {
      if (currentPlanDoc) {
        let scheduleSummary = `📅 **Updated 7-Day Athletic Plan (${currentPlanDoc.plan[0]?.date || ""} – ${currentPlanDoc.plan[currentPlanDoc.plan.length - 1]?.date || ""})**\n\n`;
        for (const day of currentPlanDoc.plan) {
          const icon = day.modality === "REST" ? "🛌" : day.modality === "KICKBOXING" || day.modality === "BJJ" ? "🥊" : "🏋️‍♂️";
          const timeStr = day.modality !== "REST" ? ` @ ${day.plannedTime}` : "";
          const classTag = day.isGymClass ? " (Gym Class)" : "";
          scheduleSummary += `* ${icon} **${day.day}** (${day.date}): **${day.focus}**${timeStr}${classTag}\n`;
        }
        if (currentPlanDoc.reasoning) {
          scheduleSummary += `\n**Coach Rationale:** ${currentPlanDoc.reasoning}\n`;
        }
        if (onToken) {
          onToken(scheduleSummary);
        }
        rationaleText = scheduleSummary;
      }
    }

    return {
      text: rationaleText,
      toolCallsExecuted,
    };
  } else {
    const fallbackResult = await handleRawJSONFallback(
      directText || "",
      userId,
      isoWeekId,
      currentPlanDoc,
      currentDateIST,
      toolCallsExecuted,
      athleteState,
      weeklyGymStore?.slots,
      userMessage
    );
    return {
      text: fallbackResult.text || "No response text generated.",
      toolCallsExecuted,
    };
  }
}

