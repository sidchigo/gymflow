/**
 * @file src/lib/telegram-service.ts
 * @description Telegram Bot integration service for GymFlow.
 *
 * Provides bidirectional communication:
 *   1. Send notifications, daily briefings, and timetable alerts.
 *   2. Process incoming user messages and slash commands (/plan, /today, /log, /sore).
 *   3. Connect directly to GymFlow's Deterministic Coach Agent Engine.
 */

import {
  getAthleteState,
  saveAthleteState,
  getWeeklyWorkoutPlan,
  saveWeeklyWorkoutPlan,
  getUserIdByTelegramChat,
  linkTelegramChat,
  getWeeklyStore,
  scheduleWeekKey,
} from "@/lib/redis";
import { nowISTDateTime } from "@/lib/schedule-service";
import { runCoachAgent } from "@/lib/agent-engine";
import {
  type DailyWorkoutPlan,
  type WeeklyWorkoutPlan,
  getDefaultAthleteState,
} from "@/types/agent";
import {
  generateDeterministicWeekPlan,
  validateAndRepairWeeklyPlan,
  getPlanningWeekKey,
} from "@/lib/deterministic-planner";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

export async function sendTelegramMessage(params: {
  chatId: string | number;
  text: string;
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  botToken?: string;
}): Promise<boolean> {
  const token = params.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[TelegramService] TELEGRAM_BOT_TOKEN is not configured.");
    return false;
  }

  const url = `${TELEGRAM_API_BASE}${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        parse_mode: params.parseMode || "Markdown",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[TelegramService] sendMessage error (${res.status}): ${errText}. Retrying plain text...`);
      // Retry without markdown in case of unescaped formatting entities
      const retryRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
        }),
      });
      return retryRes.ok;
    }

    return true;
  } catch (err) {
    console.error("[TelegramService] Failed to send telegram message:", err);
    return false;
  }
}

/**
 * Format a daily workout plan into clean, athletic Telegram markdown.
 */
export function formatDailyPlanTelegram(dayPlan: DailyWorkoutPlan, isWFO: boolean, commuteMinutes: number): string {
  const icon =
    dayPlan.modality === "REST"
      ? "🛌"
      : dayPlan.modality === "KICKBOXING" || dayPlan.modality === "BJJ"
      ? "🥊"
      : dayPlan.modality === "MOBILITY_RECOVERY"
      ? "🧘"
      : "🏋️‍♂️";

  let msg = `*${icon} ${dayPlan.day.toUpperCase()} (${dayPlan.date})*\n`;
  msg += `*Focus:* ${dayPlan.focus}\n`;
  msg += `*Modality:* \`${dayPlan.modality}\`\n`;

  if (dayPlan.modality !== "REST") {
    msg += `*Planned Time:* ${dayPlan.plannedTime} IST\n`;
    if (isWFO) {
      msg += `*Office Day (WFO):* ${commuteMinutes}m commute buffer factored in.\n`;
    }
    if (dayPlan.isGymClass) {
      msg += `*Class Type:* Scheduled Gym Session\n`;
    }

    if (dayPlan.exercises && dayPlan.exercises.length > 0) {
      msg += `\n*Prescribed Movements:*\n`;
      dayPlan.exercises.forEach((ex) => {
        const weightStr = ex.targetWeight ? ` @ ${ex.targetWeight}${ex.unit}` : "";
        const superTag = ex.supersetGroupId ? ` [Superset ${ex.supersetGroupId}${ex.orderInGroup || ""}]` : "";
        const rpeStr = ex.targetRpe ? ` (RPE ${ex.targetRpe})` : "";
        msg += `• *${ex.name}*: ${ex.sets} sets × ${ex.reps}${weightStr}${rpeStr}${superTag}\n`;
        if (ex.progressionNote) {
          msg += `   ↳ _${ex.progressionNote}_\n`;
        }
      });
    }

    if (dayPlan.nutritionAdvice) {
      msg += `\n*🥗 Nutrition & Fuel:* ${dayPlan.nutritionAdvice}\n`;
    }
  } else {
    msg += `\n*Recovery Goal:* Full rest, down-regulation breathing, and hitting baseline protein targets.\n`;
  }

  return msg;
}

/**
 * Format a 7-day weekly schedule summary for Telegram.
 */
export function formatWeeklyPlanTelegram(planDoc: WeeklyWorkoutPlan): string {
  let msg = `📅 *7-DAY ATHLETIC PERIODIZATION PLAN*\n\n`;

  for (const day of planDoc.plan) {
    const icon =
      day.modality === "REST"
        ? "🛌"
        : day.modality === "KICKBOXING" || day.modality === "BJJ"
        ? "🥊"
        : day.modality === "MOBILITY_RECOVERY"
        ? "🧘"
        : "🏋️‍♂️";

    const timeStr = day.modality !== "REST" ? ` @ ${day.plannedTime}` : "";
    const classTag = day.isGymClass ? " (Gym Class)" : "";
    msg += `${icon} *${day.day}* (${day.date}): *${day.focus}*${timeStr}${classTag}\n`;
  }

  if (planDoc.reasoning) {
    msg += `\n*Coach Reasoning:* ${planDoc.reasoning}\n`;
  }

  msg += `\n_Send /today for detailed exercise prescriptions and nutrition breakdown._`;
  return msg;
}

/**
 * Handles incoming webhook message from Telegram.
 */
export async function handleTelegramIncomingMessage(body: any): Promise<string> {
  const message = body?.message || body?.edited_message;
  if (!message || !message.text) {
    return "Ignored non-text message";
  }

  const chatId = message.chat.id;
  const rawText = message.text.trim();

  // Resolve or link user
  let existingUserId = await getUserIdByTelegramChat(chatId);
  if (existingUserId === "user_01") {
    existingUserId = null; // Clear old default placeholder
  }

  let userId = existingUserId || process.env.PRIMARY_USER_ID;

  if (!userId) {
    const match = rawText.match(/^\/start\s+(.+)$/i);
    if (match && match[1]) {
      userId = match[1].trim();
    }
  }

  let athleteState = userId ? await getAthleteState(userId) : null;

  // If no athlete state found for this userId, look up any configured athlete profile in Redis
  if (!athleteState) {
    const candidateIds = [
      "bda59e7f-454f-4bdd-bbda-0bf50f14d659",
      "mock-user-dGVzdEBleGFtcGxlLmNvbQ",
      "user_01",
    ];
    for (const cid of candidateIds) {
      const candidateState = await getAthleteState(cid);
      if (candidateState && candidateState.profile) {
        userId = cid;
        athleteState = candidateState;
        break;
      }
    }
  }

  if (!userId) {
    userId = "user_01";
  }

  if (!athleteState) {
    athleteState = getDefaultAthleteState(userId);
    await saveAthleteState(userId, athleteState);
  }

  // Ensure chat is mapped to active user
  await linkTelegramChat(chatId, userId);

  const currentDateIST = nowISTDateTime();
  const todayDateStr = currentDateIST.split("T")[0] || "";
  const isNextWeek = /next\s*week|upcoming\s*week/i.test(rawText);
  const targetWeek = getPlanningWeekKey(currentDateIST, { isNextWeek });

  // 1. Slash Command: /start
  if (rawText.startsWith("/start")) {
    const profile = athleteState.profile;
    const welcome = `🥊 *Welcome to GymFlow Coach!*\n\n` +
      `Your personal MMA & Strength & Conditioning copilot is active.\n\n` +
      `*Profile Status:*\n` +
      `• Weight: ${profile.weightKg || 69.25} kg\n` +
      `• Target: ${profile.targetDaysPerWeek || 5} training days / week\n` +
      `• Combat: ${profile.mandatoryCombatSessions?.kickboxing || 1}x KB, ${profile.mandatoryCombatSessions?.bjj || 1}x BJJ\n` +
      `• Hard Stop Cutoff: ${profile.hardStopTrainingTime || "20:00"} IST (${profile.trainingTimePreference || "EVENING"})\n\n` +
      `*Quick Commands:*\n` +
      `• \`/today\` — View today's workout & nutrition plan\n` +
      `• \`/plan\` — View or generate your 7-day schedule\n` +
      `• \`/log Bench Press 75kg 3x5\` — Log your lift performance\n` +
      `• \`/sore\` or \`/sick\` — Auto-regulate schedule for recovery\n` +
      `• Or just text me anything naturally!`;

    await sendTelegramMessage({ chatId, text: welcome });
    return "Sent start message";
  }

  // 2. Slash Command: /plan or /replan
  if (rawText.startsWith("/plan") || rawText.startsWith("/replan")) {
    const scheduleStoreKey = scheduleWeekKey(targetWeek);
    const weeklyGymStore = await getWeeklyStore(scheduleStoreKey);
    const currentPlan = await getWeeklyWorkoutPlan(userId, targetWeek);
    const planDoc = generateDeterministicWeekPlan({
      athleteState,
      weeklyGymStoreSlots: weeklyGymStore?.slots || [],
      currentPlan,
      currentDateIST,
      isNextWeek,
    });
    await saveWeeklyWorkoutPlan(userId, targetWeek, planDoc);

    const formatted = formatWeeklyPlanTelegram(planDoc);
    await sendTelegramMessage({ chatId, text: formatted });
    return "Sent weekly plan";
  }

  // 3. Slash Command: /today
  if (rawText.startsWith("/today")) {
    const scheduleStoreKey = scheduleWeekKey(targetWeek);
    const weeklyGymStore = await getWeeklyStore(scheduleStoreKey);
    let planDoc = await getWeeklyWorkoutPlan(userId, targetWeek);
    if (!planDoc) {
      planDoc = generateDeterministicWeekPlan({
        athleteState,
        weeklyGymStoreSlots: weeklyGymStore?.slots || [],
        currentDateIST,
      });
      await saveWeeklyWorkoutPlan(userId, targetWeek, planDoc);
    } else {
      // Validate and repair existing plan
      const repairedPlan = validateAndRepairWeeklyPlan(
        planDoc.plan,
        athleteState,
        currentDateIST,
        planDoc
      );
      planDoc = {
        ...planDoc,
        plan: repairedPlan,
      };
      await saveWeeklyWorkoutPlan(userId, targetWeek, planDoc);
    }

    const todayPlan = planDoc?.plan.find((d) => d.date === todayDateStr) || planDoc?.plan[0];

    if (!todayPlan) {
      await sendTelegramMessage({
        chatId,
        text: `No workout generated for today yet. Text \`/plan\` to create your 7-day schedule!`,
      });
      return "No plan found";
    }

    const dayName = todayPlan.day as "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
    const workSchedule = (athleteState.profile as any)?.weeklyWorkSchedule || {};
    const isWFO = workSchedule[dayName]?.mode === "WFO";
    const commuteMinutes = isWFO ? workSchedule[dayName]?.commuteMinutesOneWay || 0 : 0;

    const formatted = formatDailyPlanTelegram(todayPlan, isWFO, commuteMinutes);
    await sendTelegramMessage({ chatId, text: formatted });
    return "Sent today plan";
  }

  // 4. Slash Command: /log
  if (rawText.startsWith("/log")) {
    const parts = rawText.replace("/log", "").trim();
    if (!parts) {
      await sendTelegramMessage({
        chatId,
        text: `*Usage:* \`/log <Exercise Name> <Weight><kg|lbs> <Sets>x<Reps> [RPE]\`\nExample: \`/log Barbell Bench Press 70kg 3x5 8\``,
      });
      return "Log usage sent";
    }

    // Pass to agent to process performance log
    const agentResponse = await runCoachAgent({
      userId,
      userMessage: `Log my lift: ${parts}`,
    });

    await sendTelegramMessage({ chatId, text: agentResponse.text });
    return "Processed log";
  }

  // 5. Slash Command: /sore or /sick
  if (rawText.startsWith("/sore") || rawText.startsWith("/sick")) {
    const eventType = rawText.startsWith("/sick") ? "ILLNESS" : "SORENESS_OVERLOAD";
    const agentResponse = await runCoachAgent({
      userId,
      userMessage: `I am reporting ${eventType.toLowerCase().replace(/_/g, " ")}. Please auto-regulate my schedule for recovery.`,
    });

    await sendTelegramMessage({ chatId, text: agentResponse.text });
    return "Processed recovery event";
  }

  // 6. General Natural Language / Coaching Query / Replan
  try {
    const agentResponse = await runCoachAgent({
      userId,
      userMessage: rawText,
    });

    await sendTelegramMessage({ chatId, text: agentResponse.text });
    return "Processed agent query";
  } catch (err: any) {
    console.error("[TelegramService] Agent error:", err);
    await sendTelegramMessage({
      chatId,
      text: `⚠️ Coach Engine encountered an error: ${err.message || "Unknown error"}. Please try again.`,
    });
    return "Error handled";
  }
}
