"use client";

import { useState } from "react";
import { X, Save, Clock, LogOut } from "lucide-react";
import {
  type AthleteProfile,
  type Modality,
  type DietPreference,
  type WeightUnit,
} from "@/types/agent";

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

type Day = (typeof ALL_DAYS)[number];

const DAY_ABBREVS: Record<Day, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

const DIET_OPTIONS: readonly { value: DietPreference; label: string }[] = [
  { value: "HIGH_PROTEIN_NON_VEG", label: "Non-Veg" },
  { value: "HIGH_PROTEIN_VEG", label: "Veg" },
  { value: "BALANCED", label: "Balanced" },
] as const;

const MODALITY_LABELS: Record<Modality, string> = {
  KICKBOXING: "Kickboxing",
  BJJ: "BJJ",
  UPPER_HYPERTROPHY: "Upper Hyp.",
  LOWER_STRENGTH: "Lower Str.",
  BOXING_CONDITIONING: "Boxing Cond.",
  KB_CONDITIONING: "KB Cond.",
  DUT: "DUT",
  TRX: "TRX",
  AB_ASSAULT: "Ab Assault",
  MOBILITY_RECOVERY: "Mobility",
  REST: "Rest",
};

const UNIT_OPTIONS = [
  { value: "KG" as WeightUnit, label: "KG" },
  { value: "LBS" as WeightUnit, label: "LBS" },
] as const;

/** Reusable segmented pill toggle */
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  id,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  id?: string;
}) {
  return (
    <div
      id={id}
      className="flex rounded-xl border border-zinc-800 bg-zinc-900/80 p-0.5 gap-0.5"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              "flex-1 rounded-[10px] px-3 py-1.5 text-xs font-bold transition-all",
              isActive
                ? "bg-zinc-100 text-zinc-950 shadow-sm"
                : "text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ProfileSettingsDialog({
  isOpen,
  onClose,
  onSaveSuccess,
  initialProfile,
  forceSetup = false,
}: ProfileSettingsDialogProps) {
  const [weight, setWeight] = useState(initialProfile?.weightKg ?? 74);
  const [unit, setUnit] = useState<WeightUnit>(
    initialProfile?.weightUnitPreference ?? "KG"
  );
  const [height, setHeight] = useState(initialProfile?.heightCm ?? 178);
  const [diet, setDiet] = useState<DietPreference>(
    initialProfile?.dietaryPreference ?? "HIGH_PROTEIN_NON_VEG"
  );
  const [protein, setProtein] = useState(
    initialProfile?.targetDailyProteinGrams ?? 150
  );
  const [kickboxingCount, setKickboxingCount] = useState(
    initialProfile?.mandatoryCombatSessions.kickboxing ?? 1
  );
  const [bjjCount, setBjjCount] = useState(
    initialProfile?.mandatoryCombatSessions.bjj ?? 1
  );

  /**
   * Weekly work schedule — all 7 days.
   * NOTE: commute input is ALWAYS enabled regardless of WFH/WFO or weekend,
   * because users can have irregular schedules (gym instructors, weekend travel, etc.)
   */
  const [schedule, setSchedule] = useState<
    Record<string, { mode: "WFH" | "WFO"; commuteMinutesOneWay: number }>
  >(() => {
    const defaultSchedule: Record<
      string,
      { mode: "WFH" | "WFO"; commuteMinutesOneWay: number }
    > = {};
    ALL_DAYS.forEach((day) => {
      defaultSchedule[day] = initialProfile?.weeklyWorkSchedule[day] ?? {
        mode: "WFH",
        commuteMinutesOneWay: 0,
      };
    });
    return defaultSchedule;
  });

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

  const handleScheduleModeToggle = (day: string, mode: "WFH" | "WFO") => {
    setSchedule((prev) => {
      const current = prev[day];
      if (!current) return prev;
      return {
        ...prev,
        [day]: {
          ...current,
          mode,
          // Reset commute when switching to WFH only if it was previously 0
          commuteMinutesOneWay:
            mode === "WFO" && current.commuteMinutesOneWay === 0
              ? 45
              : current.commuteMinutesOneWay,
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
        [day]: { ...current, commuteMinutesOneWay: Math.max(0, val) },
      };
    });
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) window.location.href = "/login";
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
      mandatoryCombatSessions: { kickboxing: kickboxingCount, bjj: bjjCount },
      weeklyWorkSchedule: schedule as AthleteProfile["weeklyWorkSchedule"],
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
        const errData: { error?: string } = await res.json();
        throw new Error(errData.error ?? "Failed to save profile");
      }

      const data: { profile: AthleteProfile } = await res.json();
      onSaveSuccess(data.profile);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save settings.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl overflow-y-auto p-4">
      <div className="relative w-full max-w-[440px] bg-[#0c0f17] border border-zinc-800 rounded-3xl shadow-2xl flex flex-col max-h-[92dvh]">

        {/* ─── Header ──────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-6 py-5">
          <div>
            <h2 className="text-base font-extrabold text-zinc-100">
              {forceSetup ? "Athlete Profile Setup" : "Profile & Settings"}
            </h2>
            <p className="font-mono text-[10px] tracking-widest text-zinc-500 uppercase mt-1">
              Periodization &amp; Schedule Config
            </p>
          </div>
          {!forceSetup && (
            <button
              id="settings-close-btn"
              onClick={onClose}
              aria-label="Close settings"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-all"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* ─── Error Banner ─────────────────────────────────────────── */}
        {error && (
          <div className="mx-6 mt-4 rounded-xl border border-red-500/20 bg-red-950/40 px-4 py-3 text-xs text-red-300 font-medium">
            {error}
          </div>
        )}

        {/* ─── Form ─────────────────────────────────────────────────── */}
        <form
          onSubmit={handleSave}
          className="flex-1 overflow-y-auto no-scrollbar px-6 py-5 space-y-7"
        >

          {/* ── General Metrics ─────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="font-mono text-[10px] tracking-widest text-zinc-500 uppercase">
              General Metrics
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label htmlFor="settings-weight" className="block text-xs font-semibold text-zinc-400">
                  Body Weight
                </label>
                <input
                  id="settings-weight"
                  type="number"
                  step="0.25"
                  required
                  value={weight}
                  onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-zinc-200 outline-none focus:border-zinc-600 tabular-nums"
                />
                <SegmentedToggle
                  id="settings-weight-unit"
                  options={UNIT_OPTIONS}
                  value={unit}
                  onChange={setUnit}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="settings-height" className="block text-xs font-semibold text-zinc-400">
                  Height (cm)
                </label>
                <input
                  id="settings-height"
                  type="number"
                  required
                  value={height}
                  onChange={(e) => setHeight(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-zinc-200 outline-none focus:border-zinc-600 tabular-nums"
                />
              </div>
            </div>
          </section>

          {/* ── Nutrition ───────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="font-mono text-[10px] tracking-widest text-zinc-500 uppercase">
              Nutrition Settings
            </h3>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-400">
                Dietary Preference
              </label>
              <SegmentedToggle
                id="settings-diet"
                options={DIET_OPTIONS}
                value={diet}
                onChange={setDiet}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="settings-protein" className="block text-xs font-semibold text-zinc-400">
                Daily Protein Target (g)
              </label>
              <input
                id="settings-protein"
                type="number"
                required
                value={protein}
                onChange={(e) => setProtein(parseInt(e.target.value) || 0)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-zinc-200 outline-none focus:border-zinc-600 tabular-nums"
              />
            </div>
          </section>

          {/* ── Combat Commitments ──────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="font-mono text-[10px] tracking-widest text-zinc-500 uppercase">
              Combat Commitments / Week
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="settings-kickboxing" className="block text-xs font-semibold text-zinc-400">
                  Kickboxing
                </label>
                <input
                  id="settings-kickboxing"
                  type="number"
                  required
                  min={0}
                  max={7}
                  value={kickboxingCount}
                  onChange={(e) => setKickboxingCount(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-zinc-200 outline-none focus:border-zinc-600 tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="settings-bjj" className="block text-xs font-semibold text-zinc-400">
                  BJJ
                </label>
                <input
                  id="settings-bjj"
                  type="number"
                  required
                  min={0}
                  max={7}
                  value={bjjCount}
                  onChange={(e) => setBjjCount(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-zinc-200 outline-none focus:border-zinc-600 tabular-nums"
                />
              </div>
            </div>
          </section>

          {/* ── Daily Work Schedule Matrix (Mon–Sun) ─────────────────── */}
          <section className="space-y-3">
            <h3 className="font-mono text-[10px] tracking-widest text-zinc-500 uppercase">
              Daily Work Schedule Matrix
            </h3>
            <div className="space-y-2">
              {ALL_DAYS.map((day) => {
                const item = schedule[day];
                if (!item) return null;
                const isWeekend = day === "Saturday" || day === "Sunday";
                return (
                  <div
                    key={day}
                    className="flex items-center justify-between rounded-2xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-3"
                  >
                    {/* Day label */}
                    <div className="flex flex-col min-w-[44px]">
                      <span className="font-mono text-xs font-bold text-zinc-300">
                        {DAY_ABBREVS[day]}
                      </span>
                      {isWeekend && (
                        <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mt-0.5">
                          Weekend
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      {/* WFH / WFO segmented toggle */}
                      <div
                        id={`schedule-${day}-toggle`}
                        className="flex rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5 gap-0.5"
                      >
                        {(["WFH", "WFO"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => handleScheduleModeToggle(day, mode)}
                            className={[
                              "rounded-md px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider transition-all",
                              item.mode === mode
                                ? mode === "WFH"
                                  ? "bg-violet-950/80 text-violet-400 border border-violet-500/30"
                                  : "bg-sky-950/80 text-sky-400 border border-sky-500/30"
                                : "text-zinc-600 hover:text-zinc-400",
                            ].join(" ")}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>

                      {/*
                       * Commute input — ALWAYS enabled for ALL days including weekends.
                       * Bug fix: previously disabled when WFH, which prevented weekend
                       * commute configuration for users with irregular schedules.
                       */}
                      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-2 py-1.5">
                        <Clock
                          size={10}
                          strokeWidth={2}
                          className="text-zinc-500 shrink-0"
                        />
                        <input
                          type="number"
                          min={0}
                          value={item.commuteMinutesOneWay}
                          onChange={(e) =>
                            handleCommuteChange(day, parseInt(e.target.value) || 0)
                          }
                          aria-label={`${day} one-way commute minutes`}
                          className="w-10 bg-transparent text-center font-mono text-xs font-bold text-zinc-300 outline-none tabular-nums"
                        />
                        <span className="font-mono text-[10px] text-zinc-600 shrink-0">m</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Active Modalities ────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="font-mono text-[10px] tracking-widest text-zinc-500 uppercase">
              Active Modalities
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {ALL_MODALITIES.map((modality) => {
                const selected = selectedModalities.includes(modality);
                return (
                  <button
                    key={modality}
                    type="button"
                    id={`modality-${modality}`}
                    onClick={() => handleModalityToggle(modality)}
                    className={[
                      "flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-semibold text-left transition-all",
                      selected
                        ? "bg-zinc-800/60 text-zinc-100 border-zinc-600/60"
                        : "bg-zinc-900/20 text-zinc-500 border-zinc-800/50 hover:bg-zinc-900/40 hover:text-zinc-300",
                    ].join(" ")}
                  >
                    <span>{MODALITY_LABELS[modality]}</span>
                    <span
                      className={[
                        "h-2.5 w-2.5 rounded-full border flex-shrink-0 transition-all",
                        selected
                          ? "bg-zinc-100 border-zinc-100"
                          : "border-zinc-700 bg-transparent",
                      ].join(" ")}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Actions ─────────────────────────────────────────────── */}
          <div className="border-t border-zinc-800/60 pt-5 pb-2 flex gap-3">
            <button
              type="button"
              id="settings-logout-btn"
              onClick={handleLogout}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-500/20 bg-red-950/20 py-3 text-sm font-bold text-red-400 transition-all hover:bg-red-950/40 active:scale-95"
            >
              <LogOut size={13} strokeWidth={2.5} />
              Log Out
            </button>
            <button
              type="submit"
              id="settings-save-btn"
              disabled={saving}
              className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-zinc-100 py-3 text-sm font-bold text-zinc-950 transition-all hover:bg-zinc-200 active:scale-95 disabled:opacity-50"
            >
              <Save size={14} strokeWidth={2.5} />
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
