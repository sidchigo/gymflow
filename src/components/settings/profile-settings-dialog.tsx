"use client";

import { useState } from "react";
import { X, Save, Clock } from "lucide-react";
import { type AthleteProfile, type Modality, type DietPreference, type WeightUnit } from "@/types/agent";

interface ProfileSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess: (updatedProfile: AthleteProfile) => void;
  initialProfile?: AthleteProfile | null;
  forceSetup?: boolean;
}

const ALL_MODALITIES: Modality[] = [
  "KICKBOXING",
  "BJJ",
  "UPPER_HYPERTROPHY",
  "LOWER_STRENGTH",
  "BOXING_CONDITIONING",
  "KB_CONDITIONING",
  "DUT",
  "TRX",
  "AB_ASSAULT",
  "MOBILITY_RECOVERY",
];

const ALL_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
] as const;

export default function ProfileSettingsDialog({
  isOpen,
  onClose,
  onSaveSuccess,
  initialProfile,
  forceSetup = false,
}: ProfileSettingsDialogProps) {
  const [weight, setWeight] = useState(initialProfile?.weightKg ?? 74);
  const [unit, setUnit] = useState<WeightUnit>(initialProfile?.weightUnitPreference ?? "KG");
  const [height, setHeight] = useState(initialProfile?.heightCm ?? 178);
  const [diet, setDiet] = useState<DietPreference>(initialProfile?.dietaryPreference ?? "HIGH_PROTEIN_NON_VEG");
  const [protein, setProtein] = useState(initialProfile?.targetDailyProteinGrams ?? 150);
  const [kickboxingCount, setKickboxingCount] = useState(initialProfile?.mandatoryCombatSessions.kickboxing ?? 1);
  const [bjjCount, setBjjCount] = useState(initialProfile?.mandatoryCombatSessions.bjj ?? 1);

  // Initialize weekly work schedule
  const [schedule, setSchedule] = useState(() => {
    const defaultSchedule: Record<string, { mode: "WFH" | "WFO"; commuteMinutesOneWay: number }> = {};
    ALL_DAYS.forEach((day) => {
      // For Saturday/Sunday, default to WFH with 0 commute if not already set
      const isWeekend = day === "Saturday" || day === "Sunday";
      defaultSchedule[day] = initialProfile?.weeklyWorkSchedule[day] ?? {
        mode: "WFH",
        commuteMinutesOneWay: 0,
      };
      if (isWeekend && !initialProfile?.weeklyWorkSchedule[day]) {
        defaultSchedule[day] = { mode: "WFH", commuteMinutesOneWay: 0 };
      }
    });
    return defaultSchedule;
  });

  // Initialize modalities selected
  const [selectedModalities, setSelectedModalities] = useState<Modality[]>(
    initialProfile?.modalities ?? [
      "KICKBOXING",
      "BJJ",
      "UPPER_HYPERTROPHY",
      "LOWER_STRENGTH",
      "BOXING_CONDITIONING",
      "KB_CONDITIONING",
      "DUT",
      "TRX",
      "AB_ASSAULT",
      "MOBILITY_RECOVERY",
    ]
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleModalityToggle = (modality: Modality) => {
    setSelectedModalities((prev) =>
      prev.includes(modality)
        ? prev.filter((m) => m !== modality)
        : [...prev, modality]
    );
  };

  const handleScheduleModeToggle = (day: string) => {
    setSchedule((prev) => {
      const current = prev[day];
      if (!current) return prev;
      const nextMode = current.mode === "WFH" ? "WFO" : "WFH";
      return {
        ...prev,
        [day]: {
          mode: nextMode,
          commuteMinutesOneWay: nextMode === "WFO" ? 45 : 0,
        },
      };
    });
  };

  const handleCommuteChange = (day: string, val: number) => {
    setSchedule((prev) => {
      const current = prev[day];
      if (!current) return prev;
      return {
        ...prev,
        [day]: {
          ...current,
          commuteMinutesOneWay: Math.max(0, val),
        },
      };
    });
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.href = "/login";
      }
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload: Omit<AthleteProfile, "userId"> & { userId: string } = {
      userId: initialProfile?.userId ?? "temp-user",
      weightKg: weight,
      weightUnitPreference: unit,
      heightCm: height,
      targetDaysPerWeek: 5,
      mandatoryCombatSessions: {
        kickboxing: kickboxingCount,
        bjj: bjjCount,
      },
      weeklyWorkSchedule: schedule as any,
      modalities: selectedModalities,
      dietaryPreference: diet,
      targetDailyProteinGrams: protein,
    };

    try {
      const res = await fetch("/api/athlete/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to save profile");
      }

      const data = await res.json();
      onSaveSuccess(data.profile);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-850 bg-zinc-950 p-6 shadow-2xl max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-900 pb-4">
          <div>
            <h2 className="text-lg font-extrabold text-zinc-100">
              {forceSetup ? "Athlete Profile Setup" : "Profile & Schedule Settings"}
            </h2>
            <p className="text-xs text-zinc-450 mt-1">
              Configure metrics for periodization calculations.
            </p>
          </div>
          {!forceSetup && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-zinc-400 hover:text-zinc-100"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-950/40 p-3.5 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Scrollable Form Content */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto py-4 space-y-6 pr-1 no-scrollbar">
          
          {/* General Specs */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-450">General Metrics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 font-semibold mb-2">Weight</label>
                <div className="flex rounded-lg border border-zinc-850 bg-zinc-900/40 overflow-hidden focus-within:border-indigo-500">
                  <input
                    type="number"
                    required
                    value={weight}
                    onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent px-3 py-2 text-sm text-zinc-200 outline-none"
                  />
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as WeightUnit)}
                    className="bg-zinc-900 border-l border-zinc-850 text-xs px-2 font-bold text-zinc-400 outline-none cursor-pointer"
                  >
                    <option value="KG">KG</option>
                    <option value="LBS">LBS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 font-semibold mb-2">Height (cm)</label>
                <input
                  type="number"
                  required
                  value={height}
                  onChange={(e) => setHeight(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Diet Preferences */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-450">Nutrition Settings</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 font-semibold mb-2">Dietary Preference</label>
                <select
                  value={diet}
                  onChange={(e) => setDiet(e.target.value as DietPreference)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 outline-none cursor-pointer focus:border-indigo-500"
                >
                  <option value="HIGH_PROTEIN_NON_VEG">High Protein (Non-Veg)</option>
                  <option value="HIGH_PROTEIN_VEG">High Protein (Veg)</option>
                  <option value="BALANCED">Balanced Diet</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 font-semibold mb-2">Protein Target (g)</label>
                <input
                  type="number"
                  required
                  value={protein}
                  onChange={(e) => setProtein(parseInt(e.target.value) || 0)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Target Commitments */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-450">Combat Commitments</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 font-semibold mb-2">Kickboxing / Wk</label>
                <input
                  type="number"
                  required
                  min={0}
                  value={kickboxingCount}
                  onChange={(e) => setKickboxingCount(parseInt(e.target.value) || 0)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 font-semibold mb-2">BJJ Classes / Wk</label>
                <input
                  type="number"
                  required
                  min={0}
                  value={bjjCount}
                  onChange={(e) => setBjjCount(parseInt(e.target.value) || 0)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Work Schedule Matrix */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-450">Work Schedule Matrix</h3>
            <div className="space-y-3">
              {DAYS_OF_WEEK.map((day) => {
                const item = schedule[day];
                if (!item) return null;
                const isWFO = item.mode === "WFO";
                return (
                  <div key={day} className="flex items-center justify-between rounded-lg border border-zinc-900 bg-zinc-950 px-3.5 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-zinc-200">{day}</span>
                      <span className="text-[10px] text-zinc-500">Weekly Commute Mode</span>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* WFH/WFO toggle switch */}
                      <button
                        type="button"
                        onClick={() => handleScheduleModeToggle(day)}
                        className={`rounded-full px-2.5 py-1 text-2xs font-extrabold uppercase transition-all tracking-wider ${
                          isWFO
                            ? "bg-sky-950/60 text-sky-400 border border-sky-500/20"
                            : "bg-emerald-950/60 text-emerald-400 border border-emerald-500/20"
                        }`}
                      >
                        {item.mode}
                      </button>

                      {/* Commute time */}
                      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-850 bg-zinc-900/50 px-2 py-1">
                        <Clock size={11} className="text-zinc-500" />
                        <input
                          type="number"
                          value={item.commuteMinutesOneWay}
                          onChange={(e) => handleCommuteChange(day, parseInt(e.target.value) || 0)}
                          className="w-10 bg-transparent text-center text-xs font-bold text-zinc-350 outline-none"
                        />
                        <span className="text-[10px] text-zinc-500 font-semibold">m</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Modalities Multi Select */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-450">Active Modalities</h3>
            <div className="grid grid-cols-2 gap-2">
              {ALL_MODALITIES.map((modality) => {
                const selected = selectedModalities.includes(modality);
                return (
                  <button
                    key={modality}
                    type="button"
                    onClick={() => handleModalityToggle(modality)}
                    className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-xs font-bold text-left transition-all ${
                      selected
                        ? "bg-indigo-950/20 text-indigo-400 border-indigo-500/30"
                        : "bg-zinc-900/10 text-zinc-450 border-zinc-900 hover:bg-zinc-900/30"
                    }`}
                  >
                    <span>{modality.replace("_", " ")}</span>
                    <span
                      className={`h-3 w-3 rounded-full border ${
                        selected
                          ? "bg-indigo-500 border-indigo-400"
                          : "border-zinc-700 bg-transparent"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Trigger */}
          <div className="shrink-0 border-t border-zinc-900 pt-4 mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleLogout}
              className="flex-1 rounded-xl border border-red-500/20 bg-red-950/20 py-3 text-sm font-bold text-red-400 transition-all hover:bg-red-950/40 active:scale-98"
            >
              Log Out
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-[2] items-center justify-center gap-2 rounded-xl bg-zinc-100 py-3 text-sm font-bold text-zinc-950 transition-all hover:bg-zinc-200 active:scale-98 disabled:opacity-50"
            >
              <Save size={15} />
              <span>{saving ? "Saving..." : "Save Configuration"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
