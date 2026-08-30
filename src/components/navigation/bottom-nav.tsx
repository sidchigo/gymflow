"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Settings2, Sparkles } from "lucide-react";

export default function BottomNav() {
  const pathname = usePathname();

  const isHome = pathname === "/";
  const isCoach = pathname === "/coach";
  const isSettings = pathname === "/settings";

  return (
    <div className="fixed bottom-6 left-6 right-6 max-w-sm mx-auto z-50 flex justify-center lg:hidden">
      <div className="w-fit h-13 bg-zinc-950/40 backdrop-blur-xl border border-zinc-900/50 rounded-full flex items-center gap-1.5 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        {/* Home Tab */}
        <Link
          href="/"
          className={[
            "transition-all duration-200 outline-none flex items-center justify-center shrink-0",
            isHome
              ? "bg-zinc-100 text-zinc-950 h-10 px-4 rounded-full gap-1.5 shadow-sm"
              : "text-zinc-300 hover:text-white h-10 w-10 rounded-full",
          ].join(" ")}
        >
          <Home size={14} strokeWidth={2.5} />
          {isHome && <span className="text-[10px] font-bold tracking-tight">Home</span>}
        </Link>

        {/* Coach AI Tab */}
        <Link
          href="/coach"
          className={[
            "transition-all duration-200 outline-none flex items-center justify-center shrink-0",
            isCoach
              ? "bg-zinc-100 text-zinc-950 h-10 px-4 rounded-full gap-1.5 shadow-sm"
              : "text-zinc-300 hover:text-violet-400 h-10 w-10 rounded-full",
          ].join(" ")}
        >
          <Sparkles size={14} strokeWidth={2.5} />
          {isCoach && <span className="text-[10px] font-bold tracking-tight">Coach</span>}
        </Link>

        {/* Settings Tab */}
        <Link
          href="/settings"
          className={[
            "transition-all duration-200 outline-none flex items-center justify-center shrink-0",
            isSettings
              ? "bg-zinc-100 text-zinc-950 h-10 px-4 rounded-full gap-1.5 shadow-sm"
              : "text-zinc-300 hover:text-white h-10 w-10 rounded-full",
          ].join(" ")}
        >
          <Settings2 size={14} strokeWidth={2.5} />
          {isSettings && <span className="text-[10px] font-bold tracking-tight">Settings</span>}
        </Link>
      </div>
    </div>
  );
}
