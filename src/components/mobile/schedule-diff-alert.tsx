"use client";

import { X } from "lucide-react";

interface ScheduleDiffAlertProps {
  diffCount: number;
  weekNumber: string;
  onNavigateToCoach: () => void;
  onDismiss: () => void;
}

export default function ScheduleDiffAlert({
  diffCount,
  weekNumber,
  onNavigateToCoach,
  onDismiss,
}: ScheduleDiffAlertProps) {
  return (
    <div className="py-3.5 px-4 rounded-2xl bg-zinc-950/60 backdrop-blur-xl border border-white/[0.08] flex items-center justify-between gap-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-3 min-w-0">
        {/* Pulsing indicator */}
        <div className="relative flex h-2 w-2 shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </div>

        <div className="flex flex-col min-w-0">
          <span className="text-[12px] font-bold text-zinc-100 leading-tight">
            Timetable Published
          </span>
          <span className="text-[11px] text-zinc-400 font-medium leading-normal mt-0.5">
            {diffCount} sessions updated for Week {weekNumber}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onNavigateToCoach}
          className="px-3.5 py-1.5 rounded-full bg-white text-zinc-950 text-[11px] font-bold hover:bg-zinc-100 transition shadow-[0_4px_12px_rgba(255,255,255,0.1)] active:scale-95"
        >
          Update
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss schedule alert"
          className="p-1.5 text-zinc-400 hover:text-white rounded-full hover:bg-white/[0.05] transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
