import { Clock, Timer, Dumbbell, Zap, Leaf, Briefcase, Home } from "lucide-react";
import { type DailyWorkoutPlan, type AthleteState } from "@/types/agent";
import ExerciseCard from "./exercise-card";

interface DayCardViewProps {
  plan: DailyWorkoutPlan | null;
  athleteState: AthleteState;
}

function modalityLabel(plan: DailyWorkoutPlan): string {
  const base = plan.modality.replace(/_/g, " ");
  if (plan.isGymClass) return `${base} // CLASS`;
  return base;
}

function getWorkModeLabel(
  dateStr: string,
  athleteState: AthleteState
): { mode: string; commuteMinutes?: number } | null {
  const dateObj = new Date(dateStr);
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = weekdayNames[dateObj.getDay()];
  if (!dayName) return null;

  // Find schedule matching dayName
  // Keys might be uppercase or title case depending on athleteState/scenario
  const scheduleKey = (Object.keys(athleteState.profile.weeklyWorkSchedule) as Array<
    keyof typeof athleteState.profile.weeklyWorkSchedule
  >).find((k) => k.toLowerCase() === dayName.toLowerCase());
  if (!scheduleKey) return null;
  const schedule = athleteState.profile.weeklyWorkSchedule[scheduleKey];
  if (!schedule) return null;

  return {
    mode: schedule.mode === "WFO" ? "Work from Office" : "Work from Home",
    commuteMinutes: schedule.commuteMinutesOneWay,
  };
}

/* Sentence casing for LLM-authored text (e.g. nutrition advice) */
function toSentenceCase(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function splitNutrition(advice: string): { pre: string; post: string } {
  const sentences = advice.split(/(?<=[.!?])\s+/);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return {
      pre: sentences.slice(0, mid).join(" ").trim(),
      post: sentences.slice(mid).join(" ").trim(),
    };
  }
  const mid = Math.floor(advice.length / 2);
  const space = advice.indexOf(" ", mid);
  const splitAt = space > -1 ? space : mid;
  return {
    pre: advice.slice(0, splitAt).trim(),
    post: advice.slice(splitAt).trim(),
  };
}

const glassCard =
  "bg-zinc-950/40 backdrop-blur-xl border border-white/[0.07] rounded-2xl " +
  "shadow-[0_8px_28px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.04)]";

/* ─── Unified Rest / Active-Recovery Card ────────────────────────────────── */
function RestRecoveryCard({ athleteState }: { athleteState: AthleteState }) {
  const accentFrom = "#6366f1"; // Indigo accent for rest/recovery

  return (
    <div className={`relative ${glassCard} p-5 flex flex-col gap-4 overflow-hidden`}>
      {/* Accent top line */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${accentFrom}55 40%, ${accentFrom}55 60%, transparent 100%)`,
        }}
      />

      {/* Header */}
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
          Active Recovery &amp; Muscle Adaptation
        </span>
        <h2 className="text-2xl font-extrabold text-zinc-50 leading-tight tracking-tight">
          Rest &amp; Active Recovery
        </h2>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Nutrition Target */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3.5 flex flex-col gap-0.5">
          <span className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase">
            Nutrition Target
          </span>
          <span className="text-base font-extrabold text-zinc-100 mt-0.5 leading-tight">
            {athleteState.profile.targetDailyProteinGrams}g Protein
          </span>
          <span className="text-[10px] font-medium text-zinc-400 mt-1 leading-relaxed">
            Baseline protein distribution today.
          </span>
        </div>

        {/* Hydration */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3.5 flex flex-col gap-0.5">
          <span className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase">
            Hydration
          </span>
          <span className="text-base font-extrabold text-zinc-100 mt-0.5 leading-tight">
            3.5L – 4.0L
          </span>
          <span className="text-[10px] font-medium text-zinc-400 mt-1 leading-relaxed">
            Maintain baseline electrolyte balance.
          </span>
        </div>
      </div>

      {/* Mobility Routine */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3.5 flex flex-col gap-0.5">
        <span className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase">
          10-Minute Mobility Routine
        </span>
        <span className="text-base font-extrabold text-zinc-100 mt-0.5 leading-tight">
          Daily Mobility Prompt
        </span>
        <span className="text-[10px] font-medium text-zinc-400 mt-1 leading-relaxed">
          Light dynamic stretching and joint decompression movements.
        </span>
      </div>
    </div>
  );
}

/* ─── Fuel & Recovery card (unified, cohesive) ───────────────────────────── */
function NutritionCard({ plan }: { plan: DailyWorkoutPlan }) {
  const isCombat = plan.modality === "KICKBOXING" || plan.modality === "BJJ";
  const nutrition = splitNutrition(plan.nutritionAdvice);

  return (
    <div className={`${glassCard} p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <span className="font-mono text-[10px] tracking-widest text-zinc-400 uppercase">
          Fuel &amp; Recovery
        </span>
      </div>

      {/* Pre-Fuel */}
      <div className="flex items-start gap-3 px-1">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 border border-amber-400/20">
          <Zap size={13} strokeWidth={2.5} className="text-amber-300" />
        </span>
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-[10px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">
            Pre-Fuel
          </span>
          <p className="text-xs text-zinc-200 leading-relaxed">
            {toSentenceCase(nutrition.pre || plan.nutritionAdvice)}
          </p>
        </div>
      </div>

      <div className="border-t border-white/[0.06]" />

      {/* Post-Recovery */}
      <div className="flex items-start gap-3 px-1">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 border border-emerald-400/20">
          <Leaf size={13} strokeWidth={2.5} className="text-emerald-300" />
        </span>
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-[10px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">
            Post-Recovery
          </span>
          <p className="text-xs text-zinc-200 leading-relaxed">
            {toSentenceCase(
              nutrition.post
                ? nutrition.post
                : isCombat
                ? "35g Whey + Electrolytes"
                : "40g Whey Protein + Casein PM"
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DayCardView({ plan, athleteState }: DayCardViewProps) {
  /* ─── Empty State → unified rest card ──────────────────────────────────── */
  if (!plan) {
    return <RestRecoveryCard athleteState={athleteState} />;
  }

  /* ─── Populated ─────────────────────────────────────────────────────────── */
  const isRest = plan.modality === "REST" || plan.modality === "MOBILITY_RECOVERY";
  const isCombat = plan.modality === "KICKBOXING" || plan.modality === "BJJ";
  const workMode = getWorkModeLabel(plan.date, athleteState);

  /* Accent top-line colour per modality family */
  const accentFrom = isCombat ? "#f59e0b" : isRest ? "#6366f1" : "#7c3aed";

  const isWfo = workMode?.mode === "Work from Office";

  return (
    <div className="flex flex-col gap-3">

      {/* ─── Hero Session Card ──────────────────────────────────────────── */}
      <div className={`relative ${glassCard} p-5 overflow-hidden`}>
        {/* Accent top line */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${accentFrom}55 40%, ${accentFrom}55 60%, transparent 100%)`,
          }}
        />

        {/* Top Header Row: Modality & Solid Pills */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
            {modalityLabel(plan)}
          </span>

          <div className="flex items-center gap-1.5">
            {plan.isGymClass && (
              <span className="shrink-0 bg-amber-500 text-amber-950 font-bold px-2 py-0.5 rounded-full text-[9px] tracking-wider uppercase">
                CLASS
              </span>
            )}
            {workMode && (
              <span className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[9px] tracking-wider uppercase ${
                isWfo ? "bg-white text-zinc-950" : "bg-zinc-800 text-zinc-300"
              }`}>
                {isWfo ? (
                  <>
                    <Briefcase size={9} strokeWidth={2.5} />
                    WFO {workMode.commuteMinutes != null ? `· ${workMode.commuteMinutes}M` : ""}
                  </>
                ) : (
                  <>
                    <Home size={9} strokeWidth={2.5} />
                    WFH
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Main Focus / Title */}
        <div className="mt-3.5 mb-5">
          <h2 className="text-2xl font-extrabold text-zinc-50 leading-tight tracking-tight">
            {plan.focus}
          </h2>
        </div>

        {/* Bento stats row (inspired by Image 2's column cards) */}
        <div className="grid grid-cols-2 gap-2.5 border-t border-white/[0.06] pt-4">
          {plan.estimatedDurationMinutes && (
            <div className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-3 flex flex-col gap-0.5">
              <span className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase flex items-center gap-1">
                <Timer size={10} className="text-zinc-500" />
                Duration
              </span>
              <div className="flex items-baseline gap-0.5 mt-0.5">
                <span className="text-lg font-extrabold text-zinc-100 tabular-nums">
                  {plan.estimatedDurationMinutes}
                </span>
                <span className="text-[10px] font-semibold text-zinc-400 uppercase">
                  MIN
                </span>
              </div>
            </div>
          )}

          <div className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-3 flex flex-col gap-0.5">
            <span className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase flex items-center gap-1">
              <Clock size={10} className="text-zinc-500" />
              Start Time
            </span>
            <div className="flex items-baseline gap-0.5 mt-0.5">
              <span className="text-lg font-extrabold text-zinc-100 tabular-nums">
                {plan.plannedTime}
              </span>
              <span className="text-[10px] font-semibold text-zinc-400 uppercase">
                IST
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Rest Day ──────────────────────────────────────────────────── */}
      {isRest ? (
        <RestRecoveryCard athleteState={athleteState} />
      ) : (
        <>
          {/* ─── Fuel & Recovery ────────────────────────────────────── */}
          <NutritionCard plan={plan} />

          {/* ─── Exercise Deck ───────────────────────────────────────── */}
          {plan.exercises && plan.exercises.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1 mb-0.5">
                <Dumbbell size={11} className="text-zinc-400" strokeWidth={2.5} />
                <span className="font-mono text-[10px] tracking-widest text-zinc-400 uppercase">
                  Prescribed Exercises
                </span>
              </div>
              {plan.exercises.map((exercise, idx) => (
                <ExerciseCard
                  key={`${exercise.name}-${idx}`}
                  exercise={exercise}
                />
              ))}
            </div>
          )}

          {plan.exercises && plan.exercises.length === 0 && (
            <p className="text-xs text-zinc-400 italic px-1 py-2">
              No exercises listed for this modality.
            </p>
          )}
        </>
      )}
    </div>
  );
}
