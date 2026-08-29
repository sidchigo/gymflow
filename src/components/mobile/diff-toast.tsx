import { AlertTriangle, X } from "lucide-react";
import { type ScheduleDiff } from "@/types/gym";

interface DiffToastProps {
  diffs: ScheduleDiff[];
  onDismiss: () => void;
}

export default function DiffToast({ diffs, onDismiss }: DiffToastProps) {
  if (diffs.length === 0) return null;

  return (
    <div className="relative w-full border-b border-red-500/20 bg-red-950/40 px-4 py-3 text-red-300">
      <div className="flex items-start gap-2.5 pr-8">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-extrabold uppercase tracking-wide text-red-400">
            Schedule Alert ({diffs.length})
          </span>
          <div className="max-h-24 overflow-y-auto space-y-1.5 font-medium leading-relaxed">
            {diffs.map((diff, index) => {
              const formattedDate = new Date(diff.date).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              return (
                <div key={`${diff.slotId}-${index}`} className="flex flex-col">
                  <span>
                    • <strong className="font-extrabold">{diff.title}</strong> on{" "}
                    {formattedDate} has been{" "}
                    <span className="font-bold underline text-red-400">
                      {diff.type}
                    </span>
                    .
                  </span>
                  {diff.type === "RESCHEDULED" && diff.updatedTime && (
                    <span className="pl-3 text-[10px] text-zinc-400">
                      New time: {diff.updatedTime} (was {diff.originalTime})
                    </span>
                  )}
                  {diff.type === "CANCELLED" && (
                    <span className="pl-3 text-[10px] text-zinc-450">
                      Original scheduled time was {diff.originalTime}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-red-400 hover:text-red-300 active:scale-90"
      >
        <X size={14} />
      </button>
    </div>
  );
}
