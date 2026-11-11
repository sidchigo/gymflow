"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { isBiometricsSupported, authenticateWithBiometrics } from "@/lib/webauthn-client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [loading, setLoading] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsLoading, setBiometricsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;
    void isBiometricsSupported().then((supported) => {
      if (isMounted) setBiometricsAvailable(supported);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleBiometricLogin = async () => {
    setBiometricsLoading(true);
    setError(null);
    try {
      const res = await authenticateWithBiometrics();
      if (res.ok) {
        router.push("/");
        router.refresh();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Biometric login failed";
      if (!msg.toLowerCase().includes("cancel")) {
        setError(msg);
      }
    } finally {
      setBiometricsLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send OTP");
      }

      setStep("otp");
    } catch (err: any) {
      setError(err.message || "Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Invalid OTP");
      }

      // Successful verification
      router.push("/");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to verify OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        throw new Error("Failed to enter demo mode");
      }
    } catch (err: any) {
      setError(err.message || "Failed to launch demo sandbox.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 font-sans text-zinc-200">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            GymFlow
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Athletic Coach Agent & Dynamic Timetable
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-300">
            {error === "INVALID_OTP" ? "Invalid verification code. Try again." : error}
          </div>
        )}

        {step === "email" && biometricsAvailable && (
          <div className="mb-6">
            <button
              type="button"
              onClick={handleBiometricLogin}
              disabled={loading || biometricsLoading}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-950/40 hover:bg-indigo-900/40 py-3 px-4 font-semibold text-indigo-200 transition-all text-sm active:scale-98 cursor-pointer disabled:opacity-50 shadow-lg shadow-indigo-950/20"
            >
              <Fingerprint className="w-5 h-5 text-indigo-400" />
              {biometricsLoading ? "Verifying Biometrics..." : "Sign in with Face ID / Touch ID"}
            </button>

            <div className="relative my-6 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-800" />
              </div>
              <div className="relative bg-zinc-900 px-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Or continue with Email OTP
              </div>
            </div>
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={handleSendOtp} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="athlete@gymflow.com"
                className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-200 outline-none transition-all placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-zinc-100 py-3 font-bold text-zinc-950 transition-all hover:bg-zinc-200 active:scale-98 disabled:opacity-50"
            >
              {loading ? "Requesting OTP..." : "Get Access Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <div>
              <div className="flex justify-between items-center">
                <label htmlFor="otp" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Verification Code
                </label>
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                >
                  Change Email
                </button>
              </div>
              <input
                id="otp"
                type="text"
                required
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                className="mt-2 w-full text-center tracking-widest font-mono rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-200 outline-none transition-all placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 py-3 font-bold text-white transition-all hover:bg-indigo-500 active:scale-98 disabled:opacity-50 shadow-lg shadow-indigo-600/20"
            >
              {loading ? "Verifying..." : "Verify & Log In"}
            </button>
          </form>
        )}

        <div className="mt-6 pt-6 border-t border-zinc-800 text-center">
          <p className="text-xs text-zinc-400 mb-3">Recruiter / Portfolio Review?</p>
          <button
            type="button"
            onClick={handleLaunchDemo}
            disabled={loading}
            className="w-full rounded-lg border border-purple-500/40 bg-purple-950/30 hover:bg-purple-900/40 py-2.5 px-4 font-semibold text-purple-200 transition-all text-sm flex items-center justify-center gap-2 cursor-pointer"
          >
            🚀 Launch Recruiter Demo Sandbox
          </button>
        </div>
      </div>
    </div>
  );
}
