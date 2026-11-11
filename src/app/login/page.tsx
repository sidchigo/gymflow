"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getPasskeyAssertion, type PasskeyPublicKeyOptions } from "@/lib/webauthn-client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [loading, setLoading] = useState(false);
  const [showOtpFallback, setShowOtpFallback] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Handles Email submission: checks if Passkey/Windows Hello is available, otherwise sends OTP
  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    setLoading(true);
    setError(null);
    setInfoMessage(null);
    setShowOtpFallback(false);

    try {
      // 1. Check passkey availability
      const res = await fetch(`/api/auth/passkey/login-options?email=${encodeURIComponent(cleanEmail)}`, {
        method: "POST",
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        throw new Error(errData?.detail || errData?.error || "Failed to check login options.");
      }

      const data = (await res.json()) as {
        passkey_available: boolean;
        publicKey?: PasskeyPublicKeyOptions;
        otpSent?: boolean;
        message?: string;
      };

      // 2. If passkey is available on this email, prompt Windows Hello / Biometric PIN
      if (data.passkey_available && data.publicKey) {
        setInfoMessage("Prompting Windows Hello / Biometric sign-in...");
        try {
          const credential = await getPasskeyAssertion(data.publicKey);

          // Verify with passkey verify route
          const verifyRes = await fetch("/api/auth/passkey/login-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: cleanEmail, credential }),
          });

          if (!verifyRes.ok) {
            const errData = (await verifyRes.json().catch(() => null)) as { error?: string } | null;
            throw new Error(errData?.error || "Passkey verification failed.");
          }

          // Verified!
          router.push("/");
          router.refresh();
          return;
        } catch (passkeyErr: unknown) {
          const msg = passkeyErr instanceof Error ? passkeyErr.message : "Passkey not completed.";
          setShowOtpFallback(true);
          setError(
            msg.toLowerCase().includes("cancel")
              ? "Passkey authentication was cancelled. You can sign in with OTP instead."
              : `${msg} You can use OTP to continue.`
          );
          setInfoMessage(null);
          return;
        }
      }

      // 3. Passkey not available -> OTP was triggered automatically
      setStep("otp");
      setInfoMessage("OTP sent. Check your email for the verification code.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error. Please try again.";
      setError(msg);
      setShowOtpFallback(true);
    } finally {
      setLoading(false);
    }
  };

  // Explicit OTP request fallback
  const handleRequestOtpInstead = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    setLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Failed to send OTP");
      }

      setStep("otp");
      setInfoMessage("Verification code sent to your email.");
      setShowOtpFallback(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send OTP. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP submission
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Invalid OTP");
      }

      // Successful verification
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to verify OTP. Please try again.";
      setError(msg);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to launch demo sandbox.";
      setError(msg);
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

        {infoMessage && (
          <div className="mb-6 rounded-lg border border-indigo-500/30 bg-indigo-950/40 p-3.5 text-xs text-indigo-200">
            {infoMessage}
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={handleContinue} className="space-y-4">
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
                placeholder="athlete@example.com"
                className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-200 outline-none transition-all placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-zinc-100 py-3 font-bold text-zinc-950 transition-all hover:bg-zinc-200 active:scale-98 disabled:opacity-50 cursor-pointer shadow-md"
            >
              {loading ? "Checking..." : "Continue"}
            </button>

            {showOtpFallback && (
              <button
                type="button"
                onClick={handleRequestOtpInstead}
                disabled={loading}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950/80 hover:bg-zinc-800 py-2.5 px-4 font-semibold text-zinc-300 text-sm transition-all cursor-pointer"
              >
                Login with OTP Instead
              </button>
            )}
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
                  onClick={() => {
                    setStep("email");
                    setInfoMessage(null);
                    setError(null);
                  }}
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
                className="mt-2 w-full text-center tracking-widest font-mono rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-200 outline-none transition-all placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-lg"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 py-3 font-bold text-white transition-all hover:bg-indigo-500 active:scale-98 disabled:opacity-50 shadow-lg shadow-indigo-600/20 cursor-pointer"
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
