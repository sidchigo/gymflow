"use client";

interface DayPill {
  dayAbbrev: string;
  dateNum: number;
  fullDate: string;
  dotStatus: "combat" | "strength" | "rest" | "cancelled";
}

interface WeekStripProps {
  days: DayPill[];
  selectedDate: string;
  onSelectDay: (date: string) => void;
}

const DAY_MAP = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function WeekStrip({ days, selectedDate, onSelectDay }: WeekStripProps) {
  return (
    <div
      className="w-full flex items-center justify-between gap-2.5"
      role="group"
      aria-label="Week day selector"
    >
      {days.map((day, index) => {
        const isSelected = day.fullDate === selectedDate;
        const dayLabel = DAY_MAP[index] || day.dayAbbrev;

        // Determine mockup styling states based on dotStatus
        // combat/strength = checked with checkmark badge
        // rest = plain circle
        // cancelled = dashed circle
        const isCompleted = !isSelected && (day.dotStatus === "combat" || day.dotStatus === "strength");
        const isDashed = !isSelected && day.dotStatus === "cancelled";

        return (
          <button
            key={day.fullDate}
            id={`week-strip-day-${day.fullDate}`}
            onClick={() => onSelectDay(day.fullDate)}
            aria-pressed={isSelected}
            className={[
              "flex flex-col items-center gap-1.5 py-1 px-1 rounded-full outline-none select-none transition-all cursor-pointer relative backdrop-blur-md",
              isSelected
                ? "bg-zinc-900/80 border border-zinc-800/80 scale-[1.03]"
                : isCompleted
                ? "bg-zinc-900/50 border border-zinc-800/50"
                : isDashed
                ? "border border-dashed border-zinc-800 bg-transparent"
                : "bg-zinc-900/20 border border-zinc-800/30",
            ].join(" ")}
            style={{ width: "calc(14.28% - 6px)" }} // Even spacing for 7 columns with snug gaps
          >
            {/* Day name (e.g. Wed, Thu) */}
            <span
              className={[
                "text-[9px] font-semibold tracking-wider",
                isSelected ? "text-violet-400 font-bold" : "text-zinc-500",
              ].join(" ")}
            >
              {dayLabel}
            </span>

            {/* Date Circle Wrapper */}
            <div className="relative">
              {/* Date circle */}
              <span
                className={[
                  "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all tabular-nums",
                  isSelected
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-600/30"
                    : "text-zinc-300",
                ].join(" ")}
              >
                {day.dateNum}
              </span>

              {/* Checkmark badge at top-right */}
              {isCompleted && (
                <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-violet-600 border border-[#0a0014] flex items-center justify-center text-white">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="h-2 w-2"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
