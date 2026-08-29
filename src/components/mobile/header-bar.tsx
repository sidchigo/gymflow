import { RefreshCw } from "lucide-react";

interface HeaderBarProps {
  onSync: () => void;
  syncing: boolean;
}

export default function HeaderBar({ onSync, syncing }: HeaderBarProps) {
  return (
    <div className="w-full flex items-center justify-between px-1 py-1">
      {/* Brand title */}
      <span className="text-xl font-extrabold text-zinc-100 tracking-tight select-none">
        GymFlow
      </span>

      {/* Sync Button styled cleanly as a circular icon button */}
      <button
        onClick={onSync}
        disabled={syncing}
        aria-label="Sync Timetable"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800/80 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200 transition-all active:scale-90 disabled:opacity-40 outline-none"
      >
        <RefreshCw size={14} className={syncing ? "animate-spin text-violet-400" : ""} />
      </button>
    </div>
  );
}
