"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { RefreshCw, Home, Sparkles, Settings2 } from "lucide-react";

export default function GlobalHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [syncing, setSyncing] = useState(false);

  const handleSyncTimetable = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/schedule/sync?forceRefresh=true");
      if (res.ok) {
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to sync timetable:", err);
    } finally {
      setSyncing(false);
    }
  };

  const isHome = pathname === "/";
  const isCoach = pathname === "/coach";
  const isSettings = pathname === "/settings";

  return (
    <header className="relative z-20 w-full shrink-0 border-b border-zinc-900/50 bg-zinc-950/20 backdrop-blur-md px-6 py-4 flex items-center justify-between">
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
        <Link href="/" className="text-xl font-extrabold text-zinc-100 tracking-tight select-none">
          GymFlow
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1 bg-zinc-950/40 border border-zinc-900/50 rounded-full p-1 shadow-md">
          <Link
            href="/"
            className={`transition-all duration-200 outline-none flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold ${
              isHome
                ? "bg-zinc-100 text-zinc-950 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Home size={13} strokeWidth={2.5} />
            <span>Home</span>
          </Link>
          <Link
            href="/coach"
            className={`transition-all duration-200 outline-none flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold ${
              isCoach
                ? "bg-zinc-100 text-zinc-950 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Sparkles size={13} strokeWidth={2.5} />
            <span>Coach</span>
          </Link>
          <Link
            href="/settings"
            className={`transition-all duration-200 outline-none flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold ${
              isSettings
                ? "bg-zinc-100 text-zinc-950 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Settings2 size={13} strokeWidth={2.5} />
            <span>Settings</span>
          </Link>
        </nav>
        
        {/* Sync Button on the extreme right */}
        <button
          onClick={handleSyncTimetable}
          disabled={syncing}
          aria-label="Sync Timetable"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800/80 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200 transition-all active:scale-90 disabled:opacity-40 outline-none cursor-pointer"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin text-violet-400" : ""} />
        </button>
      </div>
    </header>
  );
}
