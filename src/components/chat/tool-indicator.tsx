import { Loader2 } from "lucide-react";

interface ToolIndicatorProps {
  toolName: string;
}

export default function ToolIndicator({ toolName }: ToolIndicatorProps) {
  let friendlyName = toolName;
  if (toolName === "replan_week_schedule") {
    friendlyName = "Replanning week schedule...";
  } else if (toolName === "log_lift_performance") {
    friendlyName = "Saving lift logs to history...";
  } else if (toolName === "log_athlete_event") {
    friendlyName = "Logging constraint event...";
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-950/20 px-3 py-2 text-xs font-semibold text-indigo-400">
      <Loader2 size={12} className="animate-spin text-indigo-400" />
      <span>{friendlyName}</span>
    </div>
  );
}
