"use client";

import { useState } from "react";
import { Save, Clock, LogOut, User, Apple, Swords, Calendar, Dumbbell } from "lucide-react";
import {
  type AthleteProfile,
  type Modality,
  type DietPreference,
  type WeightUnit,
} from "@/types/agent";

interface ProfileSettingsScreenProps {
  initialProfile?: AthleteProfile | null;
  onSaveSuccess?: (updatedProfile: AthleteProfile) => void;
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

/** Reusable glass segmented pill toggle */
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
      className="flex rounded-lg border border-zinc-900 bg-zinc-950/40 p-0.5 gap-0.5"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              "flex-1 rounded-[6px] px-2.5 py-1.5 text-xs font-bold transition-all duration-200 outline-none",
              isActive
                ? "bg-zinc-100 text-zinc-950 shadow-sm font-extrabold"
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

export default function ProfileSettingsScreen({
  initialProfile,
  onSaveSuccess,
}: ProfileSettingsScreenProps) {
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
  const [success, setSuccess] = useState(false);

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
    setSuccess(false);

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
      setSuccess(true);
      if (onSaveSuccess) onSaveSuccess(data.profile);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save settings.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full flex flex-col px-2">
      {/* ─── Notification Banners ───────────────────────────────────── */}
      {error && (
        <div className="mx-2 mt-2 rounded-lg border border-red-500/20 bg-red-950/40 px-3 py-2 text-xs text-red-300 font-semibold backdrop-blur-md">
          {error}
        </div>
      )}
      {success && (
        <div className="mx-2 mt-2 rounded-lg border border-emerald-500/20 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300 font-semibold backdrop-blur-md animate-fade-in">
          Profile saved successfully.
        </div>
      )}

      {/* ─── Form ─────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSave}
        className="flex-1 py-4 space-y-5"
      >
        {/* ── General Metrics ─────────────────────────────────────── */}
        <section className="space-y-3 pb-3 border-b border-zinc-900/40">
          <div className="flex items-center gap-1.5 pb-1">
            <User size={12} className="text-zinc-500" />
            <h3 className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase font-bold">
              General Metrics
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="settings-weight" className="block text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                Weight
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-950/40 px-2.5 h-10 focus-within:border-zinc-700">
                <input
                  id="settings-weight"
                  type="number"
                  step="0.25"
                  required
                  value={weight}
                  onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
                  className="w-full bg-transparent font-mono text-xs text-zinc-100 outline-none tabular-nums"
                />
                <div className="flex shrink-0 rounded-md border border-zinc-800 bg-zinc-950/60 p-0.5 gap-0.5">
                  {UNIT_OPTIONS.map((opt) => {
                    const isActive = opt.value === unit;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setUnit(opt.value)}
                        className={[
                          "rounded-[4px] px-1.5 py-0.5 font-mono text-[9px] font-extrabold tracking-wider transition-all duration-200 outline-none",
                          isActive
                            ? "bg-zinc-100 text-zinc-950 shadow-sm"
                            : "text-zinc-555 hover:text-zinc-300",
                        ].join(" ")}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="settings-height" className="block text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                Height (cm)
              </label>
              <input
                id="settings-height"
                type="number"
                required
                value={height}
                onChange={(e) => setHeight(parseFloat(e.target.value) || 0)}
                className="w-full h-10 rounded-lg border border-zinc-900 bg-zinc-950/40 px-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-700 transition-all tabular-nums"
              />
            </div>
          </div>
        </section>

        {/* ── Nutrition ───────────────────────────────────────────── */}
        <section className="space-y-3 pb-3 border-b border-zinc-900/40">
          <div className="flex items-center gap-1.5 pb-1">
            <Apple size={12} className="text-zinc-500" />
            <h3 className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase font-bold">
              Nutrition Settings
            </h3>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase tracking-wider font-bold text-zinc-400">
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
            <label htmlFor="settings-protein" className="block text-[10px] uppercase tracking-wider font-bold text-zinc-400">
              Daily Protein Target (g)
            </label>
            <input
              id="settings-protein"
              type="number"
              required
              value={protein}
              onChange={(e) => setProtein(parseInt(e.target.value) || 0)}
              className="w-full h-10 rounded-lg border border-zinc-900 bg-zinc-950/40 px-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-700 transition-all tabular-nums"
            />
          </div>
        </section>

        {/* ── Combat Commitments ──────────────────────────────────── */}
        <section className="space-y-3 pb-3 border-b border-zinc-900/40">
          <div className="flex items-center gap-1.5 pb-1">
            <Swords size={12} className="text-zinc-500" />
            <h3 className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase font-bold">
              Combat Commitments / Week
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="settings-kickboxing" className="block text-[10px] uppercase tracking-wider font-bold text-zinc-400">
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
                className="w-full h-10 rounded-lg border border-zinc-900 bg-zinc-950/40 px-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-700 transition-all tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="settings-bjj" className="block text-[10px] uppercase tracking-wider font-bold text-zinc-400">
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
                className="w-full h-10 rounded-lg border border-zinc-900 bg-zinc-950/40 px-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-700 transition-all tabular-nums"
              />
            </div>
          </div>
        </section>

        {/* ── Daily Work Schedule Matrix (Mon–Sun) ─────────────────── */}
        <section className="space-y-3 pb-3 border-b border-zinc-900/40">
          <div className="flex items-center gap-1.5 pb-1">
            <Calendar size={12} className="text-zinc-500" />
            <h3 className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase font-bold">
              Daily Work Schedule
            </h3>
          </div>
          <div className="space-y-2">
            {ALL_DAYS.map((day) => {
              const item = schedule[day];
              if (!item) return null;
              const isWeekend = day === "Saturday" || day === "Sunday";
              return (
                <div
                  key={day}
                  className="flex items-center justify-between rounded-lg border border-zinc-900 bg-zinc-950/20 px-3 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-zinc-300">
                      {DAY_ABBREVS[day]}
                    </span>
                    {isWeekend && (
                      <span className="font-mono text-[7px] text-zinc-650 uppercase tracking-wider">
                        WE
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {!isWeekend && (
                      <div
                        id={`schedule-${day}-toggle`}
                        className="flex rounded-md border border-zinc-900 bg-zinc-950/60 p-0.5 gap-0.5"
                      >
                        {(["WFH", "WFO"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => handleScheduleModeToggle(day, mode)}
                            className={[
                              "rounded-[4px] px-2.5 py-0.5 font-mono text-[9px] font-extrabold tracking-wider transition-all duration-200 outline-none",
                              item.mode === mode
                                ? "bg-zinc-100 text-zinc-950 font-extrabold shadow-sm"
                                : "text-zinc-550 hover:text-zinc-300",
                            ].join(" ")}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-1 rounded-md border border-zinc-900 bg-zinc-950/40 px-2 py-0.5">
                      <Clock
                        size={9}
                        strokeWidth={2.5}
                        className="text-zinc-650 shrink-0"
                      />
                      <input
                        type="number"
                        min={0}
                        value={item.commuteMinutesOneWay}
                        onChange={(e) =>
                          handleCommuteChange(day, parseInt(e.target.value) || 0)
                        }
                        aria-label={`${day} one-way commute minutes`}
                        className="w-6 bg-transparent text-center font-mono text-[11px] font-bold text-zinc-350 outline-none tabular-nums"
                      />
                      <span className="font-mono text-[8px] text-zinc-605 shrink-0">m</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Active Modalities ────────────────────────────────────── */}
        <section className="space-y-3 pb-3">
          <div className="flex items-center gap-1.5 pb-1">
            <Dumbbell size={12} className="text-zinc-500" />
            <h3 className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase font-bold">
              Active Modalities
            </h3>
          </div>
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
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-bold text-left transition-all duration-205 outline-none",
                    selected
                      ? "bg-zinc-900 text-zinc-200 border-zinc-800"
                      : "bg-zinc-950/30 text-zinc-655 border-zinc-950 hover:bg-zinc-900/10 hover:text-zinc-400",
                  ].join(" ")}
                >
                  <span>{MODALITY_LABELS[modality]}</span>
                  <span
                    className={[
                      "h-2.5 w-2.5 rounded-full border flex-shrink-0 transition-all duration-200",
                      selected
                        ? "bg-zinc-200 border-zinc-200 scale-100"
                        : "border-zinc-800 bg-transparent scale-90",
                    ].join(" ")}
                  />
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Actions ─────────────────────────────────────────────── */}
        <div className="border-t border-zinc-950 pt-5 pb-1 flex flex-col gap-2">
          <button
            type="submit"
            id="settings-save-btn"
            disabled={saving}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-zinc-100 h-10 text-xs font-bold text-zinc-950 transition-all hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-50 outline-none shadow-sm"
          >
            <Save size={12} strokeWidth={2.5} />
            {saving ? "Saving..." : "Save Configuration"}
          </button>
          <button
            type="button"
            id="settings-logout-btn"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-950/30 bg-red-950/10 h-10 text-xs font-bold text-red-400/90 transition-all hover:bg-red-950/20 active:scale-[0.98] outline-none"
          >
            <LogOut size={12} strokeWidth={2.5} />
            Log Out
          </button>
        </div>
      </form>
    </div>
  );
}



