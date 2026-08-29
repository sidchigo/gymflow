import { AlertTriangle, X } from "lucide-react";
import { type ScheduleDiff } from "@/types/gym";

interface DiffToastProps {
  diffs: ScheduleDiff[];
  onDismiss: () => void;
}

export default function DiffToast({ diffs, onDismiss }: DiffToastProps) {
  if (diffs.length === 0) return null;

  return (
    <div className="relative w-full shrink-0 border-b border-red-500/20 bg-red-950/30 px-4 py-3">
      <div className="flex items-start gap-2.5 pr-8">
        <AlertTriangle
          size={14}
          strokeWidth={2.5}
          className="mt-0.5 shrink-0 text-red-400"
        />
        <div className="flex flex-col gap-1.5 text-xs">
          <span className="font-mono text-[10px] tracking-widest text-red-400 uppercase">
            Schedule Alert — {diffs.length} change{diffs.length > 1 ? "s" : ""}
          </span>
          <div className="space-y-1.5 font-medium leading-relaxed text-red-300/80">
            {diffs.map((diff, index) => {
              const formattedDate = new Date(diff.date).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              return (
                <div key={`${diff.slotId}-${index}`} className="flex flex-col gap-0.5">
                  <span>
                    <strong className="font-bold text-red-300">{diff.title}</strong>
                    {" on "}
                    {formattedDate}
                    {" — "}
                    <span className="font-bold text-red-400 uppercase tracking-wide text-[10px]">
                      {diff.type}
                    </span>
                  </span>
                  {diff.type === "RESCHEDULED" && diff.updatedTime && (
                    <span className="pl-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                      {diff.originalTime} → {diff.updatedTime}
                    </span>
                  )}
                  {diff.type === "CANCELLED" && (
                    <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                      Originally at {diff.originalTime}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <button
        id="diff-toast-dismiss-btn"
        onClick={onDismiss}
        aria-label="Dismiss schedule alert"
        className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full text-red-400/70 hover:text-red-300 active:scale-90 transition-all"
      >
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}
