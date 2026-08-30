import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getAthleteState } from "@/lib/redis";
import SettingsClient from "./settings-client";

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("gymflow_session")?.value;
  let session = null;

  if (sessionToken) {
    try {
      session = await verifySessionToken(sessionToken);
    } catch {
      // Invalid token
    }
  }

  if (!session) {
    redirect("/login");
  }

  const { userId } = session;
  let athleteState = await getAthleteState(userId);

  if (!athleteState) {
    // Return standard fallback if somehow not configured
    athleteState = {
      profile: {
        userId,
        weightKg: 74,
        heightCm: 178,
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
        modalities: [
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
        ],
        dietaryPreference: "HIGH_PROTEIN_NON_VEG",
        targetDailyProteinGrams: 150,
        workDayStartTime: "09:00",
        workDayEndTime: "18:00",
        trainingTimePreference: "BOTH",
      },
      lifts: [],
      events: [],
    };
  }

  return <SettingsClient initialAthleteState={athleteState} />;
}
