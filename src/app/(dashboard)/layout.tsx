import type { Viewport } from "next";
import BottomNav from "@/components/navigation/bottom-nav";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0014",
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: LayoutProps) {
  return (
    /**
     * Full-bleed dark canvas. No max-w constraints at this level —
     * each content region controls its own width via max-w-7xl / max-w-lg.
     */
    <div className="min-h-screen bg-[#0a0014] text-zinc-100 flex flex-col antialiased selection:bg-violet-500/30 selection:text-violet-200 relative overflow-x-hidden pb-10">
      {/* Layered ambient violet glow — mirrors reference image */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: [
            "radial-gradient(ellipse 90% 65% at 50% -15%, rgba(109, 40, 217, 0.60) 0%, transparent 70%)",
            "radial-gradient(ellipse 55% 45% at 50% 0%, rgba(124, 58, 237, 0.35) 0%, transparent 60%)",
            "radial-gradient(ellipse 100% 70% at 50% 110%, rgba(45, 0, 90, 0.35) 0%, transparent 70%)",
          ].join(", "),
        }}
      />
      
      {/* Top Brand Bar */}
      <header className="relative z-20 w-full shrink-0 border-b border-zinc-900/50 bg-zinc-950/20 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <span className="text-xl font-extrabold text-zinc-100 tracking-tight select-none">
            GymFlow
          </span>
        </div>
      </header>

      {/* Scrollable content layer */}
      <div className="relative z-10 flex flex-col flex-1">
        {children}
      </div>

      {/* Shared Bottom Navigation Bar */}
      <BottomNav />
    </div>
  );
}

