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
  activeWeek?: string | undefined;
  onPrevWeek?: (() => void) | undefined;
  onNextWeek?: (() => void) | undefined;
}

const DAY_MAP = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function WeekStrip({
  days,
  selectedDate,
  onSelectDay,
  activeWeek,
  onPrevWeek,
  onNextWeek,
}: WeekStripProps) {
  const weekLabel = activeWeek ? activeWeek.replace("_", "-").split("-")[1] : "";

  return (
    <div className="flex flex-col gap-2">
      {activeWeek && onPrevWeek && onNextWeek && (
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
            TRAINING WEEK
          </span>
        <div className="flex items-center gap-2.5 bg-zinc-950/20 backdrop-blur-md border border-zinc-900/50 rounded-full px-3 py-1 text-xs">
            <button
              onClick={onPrevWeek}
              aria-label="Previous week"
              className="flex min-w-9 h-9 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 font-bold select-none transition-colors cursor-pointer outline-none"
            >
              &lt;
            </button>
            <span className="font-mono text-zinc-300 font-bold uppercase tracking-wider">
              {weekLabel}
            </span>
            <button
              onClick={onNextWeek}
              aria-label="Next week"
              className="flex min-w-9 h-9 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 font-bold select-none transition-colors cursor-pointer outline-none"
            >
              &gt;
            </button>
          </div>
        </div>
      )}

      <div
        className="w-full flex items-center justify-between lg:grid lg:grid-cols-7 gap-2 lg:gap-3"
        role="group"
        aria-label="Week day selector"
      >
      {days.map((day, index) => {
        const isSelected = day.fullDate === selectedDate;
        const dayLabel = DAY_MAP[index] || day.dayAbbrev;

        const isDashed = !isSelected && day.dotStatus === "cancelled";

        return (
          <button
            key={day.fullDate}
            id={`week-strip-day-${day.fullDate}`}
            onClick={() => onSelectDay(day.fullDate)}
            aria-pressed={isSelected}
            className={[
              "flex-1 lg:w-full flex flex-col items-center gap-1.5 py-2 px-1 rounded-full lg:rounded-2xl outline-none select-none transition-all cursor-pointer relative backdrop-blur-md",
              isSelected
                ? "bg-zinc-100/20 border border-zinc-100/30 scale-[1.03]"
                : isDashed
                ? "border border-dashed border-zinc-100/20 bg-transparent"
                : "bg-zinc-100/5 border border-zinc-100/5",
            ].join(" ")}
          >
            {/* Day name (e.g. Wed, Thu) */}
            <span
              className={[
                "text-[9px] lg:text-[10px] font-semibold tracking-wider",
                isSelected ? "text-zinc-100 font-bold" : "text-zinc-500",
              ].join(" ")}
            >
              {dayLabel}
            </span>

            {/* Date Circle */}
            <span
              className={[
                "h-7 w-7 lg:h-9 lg:w-9 rounded-full flex items-center justify-center text-[11px] lg:text-xs font-bold transition-all tabular-nums",
                isSelected
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-300",
              ].join(" ")}
            >
              {day.dateNum}
            </span>
          </button>
        );
      })}
    </div>
    </div>
  );
}
