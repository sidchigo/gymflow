import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Space_Mono } from "next/font/google";
import "./globals.css";
import { PWARegister } from "@/components/pwa-register";

const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GymFlow — Athletic Performance OS",
  description:
    "AI-powered athletic performance dashboard. Plan workouts, track progressive overload, and adapt your week in real time.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GymFlow",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0014",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${jakartaSans.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
