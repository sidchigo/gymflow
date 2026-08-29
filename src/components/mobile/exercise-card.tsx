import { Clock, TrendingUp } from "lucide-react";
import { type PlannedExercise } from "@/types/agent";

interface ExerciseCardProps {
  exercise: PlannedExercise;
}

export default function ExerciseCard({ exercise }: ExerciseCardProps) {
  const isSuperset = !!exercise.supersetGroupId;
  const supersetLabel = isSuperset
    ? `${exercise.supersetGroupId}${exercise.orderInGroup || 1}`
    : null;

  return (
    <div
      className={`relative flex flex-col p-4 transition-all ${
        isSuperset
          ? "border-l-4 border-indigo-500 bg-indigo-950/10 rounded-r-lg my-2"
          : "rounded-xl border border-zinc-900 bg-zinc-950/40 my-2.5"
      }`}
    >
      {/* Superset Group Indicator */}
      {supersetLabel && (
        <span className="absolute top-3 right-3 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-indigo-400 uppercase">
          Superset {supersetLabel}
        </span>
      )}

      {/* Exercise Name */}
      <h4 className="text-sm font-extrabold text-zinc-100 pr-16">{exercise.name}</h4>

      {/* Prescribed Sets & Reps & Weight */}
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-extrabold text-zinc-200">
          {exercise.sets} <span className="text-zinc-500 font-medium">×</span> {exercise.reps}
        </span>
        {exercise.targetWeight !== undefined && exercise.targetWeight !== null && (
          <>
            <span className="text-zinc-500">@</span>
            <span className="font-extrabold text-zinc-100">
              {exercise.targetWeight} {exercise.unit}
            </span>
          </>
        )}
        {exercise.targetRpe && (
          <>
            <span className="text-zinc-600 font-light">•</span>
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-semibold text-zinc-400">
              RPE {exercise.targetRpe}
            </span>
          </>
        )}
      </div>

      {/* Footer Metadata: Rest, Progression Note */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-900/60 pt-2.5 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Clock size={11} className="text-zinc-500" />
          {exercise.restSeconds}s rest
        </span>

        {exercise.progressionNote && (
          <span className="flex items-center gap-1 text-indigo-400">
            <TrendingUp size={11} />
            {exercise.progressionNote}
          </span>
        )}
      </div>
    </div>
  );
}
