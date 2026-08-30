import { Clock, TrendingUp, Link2 } from "lucide-react";
import { type PlannedExercise } from "@/types/agent";

interface ExerciseCardProps {
  exercise: PlannedExercise;
}

export default function ExerciseCard({ exercise }: ExerciseCardProps) {
  const isSuperset = !!exercise.supersetGroupId;

  /* Clean label: "A1", "B2" (no brackets) */
  const supersetLabel = isSuperset
    ? `${exercise.supersetGroupId}${exercise.orderInGroup ?? ""}`
    : null;

  /* Telemetry readout: "3 sets × 8-12 reps • 85.0 kg • RPE 8.0" */
  const telemetryParts: string[] = [
    `${exercise.sets} sets × ${exercise.reps} reps`,
  ];
  if (exercise.targetWeight != null) {
    telemetryParts.push(`${exercise.targetWeight.toFixed(1)} ${exercise.unit}`);
  }
  if (exercise.targetRpe != null) {
    telemetryParts.push(`RPE ${exercise.targetRpe.toFixed(1)}`);
  }
  const telemetry = telemetryParts.join(" • ");

  return (
    <div className="relative flex flex-col gap-2 rounded-xl bg-zinc-950/40 backdrop-blur-xl border border-white/[0.07] p-4 pl-5 shadow-[0_6px_20px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.04)]">
      {/* ─── Superset left accent bar ───────────────────────────────── */}
      {isSuperset && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-emerald-500"
        />
      )}

      {/* ─── Header Row ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold text-zinc-50 leading-snug flex-1 min-w-0">
          {exercise.name}
        </h4>

        {/* Superset pair badge */}
        {isSuperset && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300">
            <Link2 size={9} strokeWidth={2.5} />
            {supersetLabel}
          </span>
        )}
      </div>

      {/* ─── Telemetry Readout ───────────────────────────────────────── */}
      <span className="font-mono text-xs text-zinc-300 tabular-nums tracking-wide leading-relaxed">
        {telemetry}
      </span>

      {/* ─── Footer: Rest + Progression Delta ──────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/[0.06] pt-2">
        <span className="flex items-center gap-1.5 font-mono text-xs text-zinc-400 tabular-nums">
          <Clock size={10} strokeWidth={2} className="text-zinc-500 shrink-0" />
          {exercise.restSeconds}s rest
        </span>

        {exercise.progressionNote && (
          <span className="flex items-center gap-1.5 text-xs text-violet-300 font-medium">
            <TrendingUp size={10} strokeWidth={2} className="shrink-0" />
            {exercise.progressionNote}
          </span>
        )}
      </div>
    </div>
  );
}
