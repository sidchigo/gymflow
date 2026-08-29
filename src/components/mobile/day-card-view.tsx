import { Zap, Clock, Timer, Dumbbell, Battery, MapPin, Activity } from "lucide-react";
import { type DailyWorkoutPlan } from "@/types/agent";
import ExerciseCard from "./exercise-card";

interface DayCardViewProps {
  plan: DailyWorkoutPlan | null;
}

function modalityLabel(plan: DailyWorkoutPlan): string {
  const base = plan.modality.replace(/_/g, " ");
  if (plan.isGymClass) return `${base} // CLASS`;
  return base;
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

export default function DayCardView({ plan }: DayCardViewProps) {
  /* ─── Empty State ──────────────────────────────────────────────────────── */
  if (!plan) {
    return (
      <div
        className="relative rounded-3xl border border-zinc-800/60 p-8 flex flex-col items-center text-center gap-6 overflow-hidden"
        style={{
          background:
            "linear-gradient(160deg, #0f1520 0%, #0c0f17 50%, #090d14 100%)",
          boxShadow: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Ambient dot grid background decoration */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Animated icon container */}
        <div
          className="relative flex h-20 w-20 items-center justify-center rounded-3xl"
          style={{
            background:
              "linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(124,58,237,0.04) 100%)",
            border: "1px solid rgba(124,58,237,0.22)",
            boxShadow: "0 0 32px rgba(124,58,237,0.14)",
          }}
        >
          <Activity
            size={36}
            strokeWidth={1.5}
            className="text-violet-400"
            style={{ filter: "drop-shadow(0 0 8px rgba(124,58,237,0.5))" }}
          />
          {/* Pulse ring */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-3xl animate-ping"
            style={{
              border: "1px solid rgba(124,58,237,0.18)",
              animationDuration: "2.5s",
            }}
          />
        </div>

        {/* Copy */}
        <div className="space-y-2 relative">
          <h3 className="text-xl font-bold text-zinc-100 leading-tight">
            No Protocol Scheduled
          </h3>
          <p className="font-mono text-[11px] tracking-widest text-zinc-600 uppercase">
            No programmed protocol for this date
          </p>
          <p className="text-sm text-zinc-500 leading-relaxed max-w-[240px] mx-auto mt-1">
            Ask the coach to generate an optimal training split for this week.
          </p>
        </div>

        {/* Gradient CTA button */}
        <button
          id="generate-split-btn"
          className="relative flex items-center gap-2.5 rounded-full px-7 py-3.5 text-sm font-bold text-white transition-all active:scale-95 overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #5b21b6 100%)",
            boxShadow:
              "0 0 20px rgba(124,58,237,0.45), 0 0 8px rgba(124,58,237,0.22), 0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {/* Button inner shimmer */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%)",
            }}
          />
          <Zap size={15} strokeWidth={2.5} />
          Generate Tactical Split
        </button>
      </div>
    );
  }

  /* ─── Populated ────────────────────────────────────────────────────────── */
  const isRest = plan.modality === "REST" || plan.modality === "MOBILITY_RECOVERY";
  const isCombat = plan.modality === "KICKBOXING" || plan.modality === "BJJ";
  const nutrition = splitNutrition(plan.nutritionAdvice);

  /* Accent color per modality family */
  const accentColor = isCombat
    ? { from: "#f59e0b", to: "#d97706", glow: "rgba(245,158,11,0.3)" }
    : isRest
    ? { from: "#6366f1", to: "#4f46e5", glow: "rgba(99,102,241,0.3)" }
    : { from: "#7c3aed", to: "#6d28d9", glow: "rgba(124,58,237,0.30)" };

  return (
    <div className="flex flex-col gap-3">

      {/* ─── Hero Session Card ──────────────────────────────────────────── */}
      <div
        className="relative rounded-3xl border border-zinc-800/60 p-5 overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #111520 0%, #0c0f17 100%)",
          boxShadow: `0 0 40px ${accentColor.glow}, 0 1px 0 0 rgba(255,255,255,0.04) inset, 0 16px 40px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Accent top line */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${accentColor.from}55 40%, ${accentColor.from}55 60%, transparent 100%)`,
          }}
        />

        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            {/* Modality label: mono accent */}
            <span className="font-mono text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
              {modalityLabel(plan)}
            </span>
            {/* Focus headline: display font, generous size */}
            <h2 className="text-xl font-extrabold text-zinc-50 leading-tight">
              {plan.focus}
            </h2>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            {plan.isGymClass && (
              <span
                className="rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300"
                style={{
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.3)",
                  boxShadow: "0 0 8px rgba(245,158,11,0.15)",
                }}
              >
                GYM CLASS
              </span>
            )}
            <span className="font-mono text-xs tabular-nums text-zinc-500">
              {plan.plannedTime} IST
            </span>
          </div>
        </div>

        {/* Sub-row: telemetry chips */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-800/40 pt-4">
          {plan.estimatedDurationMinutes && (
            <span
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] text-zinc-400 tabular-nums"
              style={{ background: "#111520", border: "1px solid rgba(63,63,70,0.6)" }}
            >
              <Timer size={11} strokeWidth={2} className="text-zinc-600" />
              {plan.estimatedDurationMinutes} MIN
            </span>
          )}
          <span
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] text-zinc-400 tabular-nums"
            style={{ background: "#111520", border: "1px solid rgba(63,63,70,0.6)" }}
          >
            <Clock size={11} strokeWidth={2} className="text-zinc-600" />
            {plan.plannedTime}
          </span>
          {plan.isGymClass && (
            <span
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] text-zinc-500"
              style={{ background: "#111520", border: "1px solid rgba(63,63,70,0.6)" }}
            >
              <MapPin size={11} strokeWidth={2} className="text-zinc-600" />
              {plan.focus}
            </span>
          )}
        </div>
      </div>

      {/* ─── Rest Day ──────────────────────────────────────────────────── */}
      {isRest ? (
        <div
          className="rounded-3xl border border-zinc-800/60 p-8 flex flex-col items-center text-center gap-4"
          style={{
            background: "linear-gradient(160deg, #111520 0%, #0c0f17 100%)",
            boxShadow: "0 0 32px rgba(99,102,241,0.08)",
          }}
        >
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.2)",
            }}
          >
            <Battery size={24} strokeWidth={1.5} className="text-indigo-400" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-bold text-zinc-200">Rest &amp; Active Recovery</h3>
            <p className="text-xs text-zinc-500 leading-relaxed max-w-[240px]">
              No prescribed heavy resistance training today. Focus on sleep, mobility, and recovery.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ─── Nutrition Bento ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            {/* PRE-FUEL */}
            <div
              className="rounded-2xl p-4 flex flex-col gap-2.5"
              style={{
                background:
                  "linear-gradient(135deg, rgba(124,58,237,0.09) 0%, #0c0f17 100%)",
                border: "1px solid rgba(124,58,237,0.20)",
              }}
            >
              <span className="font-mono text-[10px] tracking-widest text-violet-400 uppercase">
                Pre-Fuel
              </span>
              <p className="text-xs text-zinc-300 leading-relaxed font-medium">
                {nutrition.pre || plan.nutritionAdvice}
              </p>
            </div>

            {/* POST-RECOVERY */}
            <div
              className="rounded-2xl p-4 flex flex-col gap-2.5"
              style={{
                background:
                  "linear-gradient(135deg, rgba(56,189,248,0.07) 0%, #0c0f17 100%)",
                border: "1px solid rgba(56,189,248,0.15)",
              }}
            >
              <span className="font-mono text-[10px] tracking-widest text-sky-400 uppercase">
                Post-Recovery
              </span>
              <p className="text-xs text-zinc-300 leading-relaxed font-medium">
                {nutrition.post
                  ? nutrition.post
                  : isCombat
                  ? "35g Whey + Electrolytes"
                  : "40g Whey Protein + Casein PM"}
              </p>
            </div>
          </div>

          {/* ─── Exercise Deck ───────────────────────────────────────── */}
          {plan.exercises && plan.exercises.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1 mb-0.5">
                <Dumbbell size={11} className="text-zinc-600" strokeWidth={2.5} />
                <span className="font-mono text-[10px] tracking-widest text-zinc-600 uppercase">
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
            <p className="text-xs text-zinc-600 italic px-1 py-2">
              No exercises listed for this modality.
            </p>
          )}
        </>
      )}
    </div>
  );
}
