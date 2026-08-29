import { Clock, TrendingUp } from "lucide-react";
import { type PlannedExercise } from "@/types/agent";

interface ExerciseCardProps {
  exercise: PlannedExercise;
}

export default function ExerciseCard({ exercise }: ExerciseCardProps) {
  const isSuperset = !!exercise.supersetGroupId;
  const supersetLabel = isSuperset
    ? `[${exercise.supersetGroupId}${exercise.orderInGroup ?? ""}]`
    : null;

  return (
    <div
      className={[
        "relative flex flex-col transition-all",
        isSuperset
          ? "border-l-2 border-violet-500 bg-violet-950/10 rounded-r-2xl p-4 my-1"
          : "bg-[#0e121d] border border-zinc-800/90 rounded-2xl p-4 my-1",
      ].join(" ")}
    >
      {/* ─── Header Row ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold text-zinc-100 leading-snug flex-1 min-w-0">
          {exercise.name}
        </h4>

        {/* Superset badge [A1] */}
        {supersetLabel && (
          <span className="shrink-0 font-mono text-[10px] font-bold tracking-wider text-violet-400 bg-violet-950/60 border border-violet-500/30 rounded px-1.5 py-0.5">
            {supersetLabel}
          </span>
        )}
      </div>

      {/* ─── Metric Pills Row ───────────────────────────────────────── */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {/* Sets */}
        <span className="rounded-lg bg-zinc-800/70 border border-zinc-700/50 px-2.5 py-1 font-mono text-xs text-zinc-300 tabular-nums">
          {exercise.sets} sets
        </span>

        {/* Reps */}
        <span className="rounded-lg bg-zinc-800/70 border border-zinc-700/50 px-2.5 py-1 font-mono text-xs text-zinc-300">
          {exercise.reps} reps
        </span>

        {/* Target Weight */}
        {exercise.targetWeight != null && (
          <span className="rounded-lg bg-zinc-800/70 border border-zinc-700/50 px-2.5 py-1 font-mono text-xs font-bold text-zinc-100 tabular-nums">
            {exercise.targetWeight.toFixed(1)}{" "}
            <span className="text-zinc-400 font-medium uppercase text-[10px]">
              {exercise.unit}
            </span>
          </span>
        )}

        {/* RPE */}
        {exercise.targetRpe != null && (
          <span className="rounded-lg bg-zinc-800/70 border border-zinc-700/50 px-2.5 py-1 font-mono text-[11px] text-zinc-400 tabular-nums">
            RPE {exercise.targetRpe.toFixed(1)}
          </span>
        )}
      </div>

      {/* ─── Footer: Rest + Progression Delta ──────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-800/40 pt-2.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500 tabular-nums">
          <Clock size={10} strokeWidth={2} className="text-zinc-600 shrink-0" />
          {exercise.restSeconds}s rest
        </span>

        {exercise.progressionNote && (
          <span className="flex items-center gap-1.5 text-[11px] text-violet-400 font-medium">
            <TrendingUp size={10} strokeWidth={2} className="shrink-0" />
            {exercise.progressionNote}
          </span>
        )}
      </div>
    </div>
  );
}
