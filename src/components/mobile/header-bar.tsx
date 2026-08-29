import { RefreshCw, MapPin } from "lucide-react";

interface HeaderBarProps {
  currentDateStr: string; // e.g. "Sat, 29 Aug"
  weightKg: number;
  workMode: "WFH" | "WFO";
  onSync: () => void;
  syncing: boolean;
}

export default function HeaderBar({
  currentDateStr,
  weightKg,
  workMode,
  onSync,
  syncing,
}: HeaderBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-zinc-900 bg-black/90 px-4 backdrop-blur-md">
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">GymFlow</span>
        <span className="text-sm font-bold text-zinc-100">{currentDateStr}</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Weight Badge */}
        <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-bold text-zinc-300 border border-zinc-800">
          {weightKg} kg
        </span>

        {/* Work Mode Badge */}
        {workMode === "WFH" ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-950/60 px-2.5 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
            <span>🏡</span> WFH
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-sky-950/60 px-2.5 py-1 text-xs font-semibold text-sky-400 border border-sky-500/20">
            <MapPin size={10} /> WFO
          </span>
        )}

        {/* Sync Button */}
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-850 bg-zinc-950 text-zinc-400 transition-all hover:bg-zinc-900 hover:text-zinc-100 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin text-indigo-400" : ""} />
        </button>
      </div>
    </header>
  );
}
