interface DayPill {
  dayAbbrev: string; // M, T, W, T, F, S, S
  dateNum: number; // 24, 25...
  fullDate: string; // YYYY-MM-DD
  dotStatus: "combat" | "strength" | "rest" | "cancelled";
}

interface WeekStripProps {
  days: DayPill[];
  selectedDate: string; // YYYY-MM-DD
  onSelectDay: (date: string) => void;
}

export default function WeekStrip({ days, selectedDate, onSelectDay }: WeekStripProps) {
  return (
    <div className="flex w-full overflow-x-auto border-b border-zinc-900 bg-zinc-950/60 py-3.5 px-4 gap-2.5 no-scrollbar scroll-smooth">
      {days.map((day) => {
        const isSelected = day.fullDate === selectedDate;
        return (
          <button
            key={day.fullDate}
            onClick={() => onSelectDay(day.fullDate)}
            className={`flex min-w-[48px] flex-1 flex-col items-center justify-center rounded-xl py-2.5 transition-all outline-none active:scale-95 ${
              isSelected
                ? "bg-zinc-100 text-zinc-950 font-bold shadow-lg shadow-zinc-100/10"
                : "bg-zinc-900/40 text-zinc-400 border border-zinc-800/80 hover:bg-zinc-900/60"
            }`}
          >
            <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">
              {day.dayAbbrev}
            </span>
            <span className="mt-1 text-base font-extrabold">{day.dateNum}</span>

            {/* Dot indicator */}
            <span className="mt-1.5 flex h-1.5 w-1.5 justify-center">
              {day.dotStatus === "cancelled" && (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              )}
              {day.dotStatus === "combat" && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
              {day.dotStatus === "strength" && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
              {day.dotStatus === "rest" && (
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
