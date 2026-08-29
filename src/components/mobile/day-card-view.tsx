import { Calendar, Dumbbell } from "lucide-react";
import { type DailyWorkoutPlan } from "@/types/agent";
import ExerciseCard from "./exercise-card";

interface DayCardViewProps {
  plan: DailyWorkoutPlan | null;
  className?: string;
}

export default function DayCardView({ plan, className = "" }: DayCardViewProps) {
  if (!plan) {
    return (
      <div className={`flex flex-col items-center justify-center py-20 text-center ${className}`}>
        <div className="rounded-full bg-zinc-950 p-4 border border-zinc-900">
          <Calendar className="text-zinc-600" size={32} />
        </div>
        <p className="mt-4 text-zinc-500 text-sm font-semibold">No workout planned for this day.</p>
        <p className="mt-1 text-xs text-zinc-650">Ask Coach AI to generate a plan!</p>
      </div>
    );
  }

  const isRest = plan.modality === "REST";

  return (
    <div className={`flex flex-col px-4 pb-24 overflow-y-auto ${className}`}>
      {/* Modality Hero & Overview Card */}
      <div className="rounded-2xl border border-zinc-900 bg-zinc-950/40 p-5 mt-4">
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-indigo-400 font-extrabold">
              {plan.modality.replace("_", " ")}
            </span>
            <h2 className="mt-1 text-xl font-extrabold text-zinc-100 leading-tight">
              {plan.focus}
            </h2>
          </div>

          {plan.isGymClass && (
            <span className="flex items-center gap-1 rounded bg-yellow-950/60 border border-yellow-500/20 px-2 py-0.5 text-[10px] font-bold text-yellow-400 uppercase tracking-wide">
              Verified Class
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 text-xs font-semibold text-zinc-400">
          <span>🕒 {plan.plannedTime} IST</span>
          {plan.estimatedDurationMinutes && (
            <span>⏱️ {plan.estimatedDurationMinutes} mins</span>
          )}
        </div>
      </div>

      {/* Rest Day State */}
      {isRest ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="text-4xl">🔋</span>
          <h3 className="mt-4 text-base font-extrabold text-zinc-300">Rest & Active Recovery</h3>
          <p className="mt-1 text-xs text-zinc-500 max-w-[240px]">
            No prescribed heavy resistance training today. Focus on sleep, mobility, and recovery.
          </p>
        </div>
      ) : (
        <>
          {/* Nutrition Card */}
          <div className="mt-4 rounded-xl border border-emerald-950/30 bg-emerald-950/10 p-4">
            <h3 className="text-xs font-extrabold text-emerald-400 uppercase tracking-wider mb-2">
              Peri-Workout Fuel
            </h3>
            <p className="text-sm font-semibold text-emerald-300 leading-relaxed">
              {plan.nutritionAdvice}
            </p>
          </div>

          {/* Exercise List */}
          <div className="mt-6 flex flex-col">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Dumbbell size={12} /> Prescribed Exercises
            </h3>
            {plan.exercises && plan.exercises.length > 0 ? (
              <div className="flex flex-col">
                {plan.exercises.map((exercise, idx) => (
                  <ExerciseCard key={`${exercise.name}-${idx}`} exercise={exercise} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic py-2">No exercises listed for this modality.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
