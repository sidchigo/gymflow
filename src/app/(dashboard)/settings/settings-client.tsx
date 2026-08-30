"use client";

import { useState } from "react";
import { type AthleteProfile, type AthleteState } from "@/types/agent";
import ProfileSettingsScreen from "@/components/settings/profile-settings-screen";

interface SettingsClientProps {
  initialAthleteState: AthleteState;
}

export default function SettingsClient({ initialAthleteState }: SettingsClientProps) {
  const [athleteState, setAthleteState] = useState<AthleteState>(initialAthleteState);

  const handleSaveSuccess = (updatedProfile: AthleteProfile) => {
    setAthleteState((prev) => ({ ...prev, profile: updatedProfile }));
  };

  return (
    <div className="flex-1 flex flex-col max-w-xl mx-auto w-full px-4 pt-4 pb-16 lg:py-6">
      <ProfileSettingsScreen
        initialProfile={athleteState.profile}
        onSaveSuccess={handleSaveSuccess}
      />
    </div>
  );
}
