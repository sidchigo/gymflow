import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-black text-zinc-100 antialiased pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      {children}
    </div>
  );
}
