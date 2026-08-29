# SPEC-004: AI Coach Engine & Adaptive Planning Workflow

## 1. Context & Goal
- **Problem:** Static training routines fail to adapt to live calendar changes, fluctuating work modes (WFH vs. WFO), systemic fatigue, and unexpected mid-week gym slot cancellations. Generic AI workout generators provide vague text routines without structured progressive overload, unit flexibility (kg vs. lbs), superset grouping, or peri-workout nutrition.
- **Goal:** Implement an autonomous athletic coaching agent powered by Google GenAI (Gemini) that ingests the user's weekly constraints, historical lift logs, available gym schedule, and diff alerts to generate, explain, progress, and dynamically replan a balanced 5-day combat/strength periodization block using deterministic function calling.

---

## 2. Invariants & Guardrails

- **Domain Persona Constraint:** The LLM acts exclusively as an elite Strength & Conditioning (S&C) and MMA trainer. Tone is grounded, direct, athletic, and actionable (no fluffy greetings, no generic non-answers).
- **Ground Truth Grounding:** The agent MUST ONLY schedule class activities that exist within the ingested `WeeklyScheduleStore.slots`. For standalone strength/conditioning sessions (non-class slots), it must schedule them only during standard open-gym hours.
- **Deterministic State Mutation:** The agent MUST NOT modify the weekly plan or log workout performance via raw Markdown text. Any creation, alteration of the schedule, or lift logging MUST be executed via explicit **Tool Calling / Function Calling** (`replan_week_schedule`, `log_lift_performance`, `log_athlete_event`).
- **Safety & Recovery Invariant:** 
  - If a user reports fever, illness, or acute joint pain, the agent MUST immediately cancel high-intensity sessions and program rest or low-intensity mobility.
  - Never program heavy lower-body compound lifts (heavy squats/deadlifts) within 12 hours before or immediately after high-intensity BJJ/Kickboxing sparring.
  - Cap lift intensity at **RPE $\le$ 7.5** on sessions immediately following high-output combat sessions.

---

## 3. Athlete Context & Input Schemas

### A. Static & Dynamic Athlete Profile (`AthleteProfile`)
```typescript
export type WorkMode = 'WFH' | 'WFO';
export type DietPreference = 'HIGH_PROTEIN_NON_VEG' | 'HIGH_PROTEIN_VEG' | 'BALANCED';
export type WeightUnit = 'KG' | 'LBS';

export interface AthleteProfile {
  userId: string;
  weightKg: number;
  heightCm: number;
  targetDaysPerWeek: 5;
  weightUnitPreference: WeightUnit;
  mandatoryCombatSessions: {
    kickboxing: number; // e.g. 1
    bjj: number;        // e.g. 1
  };
  weeklyWorkSchedule: Record<
    'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday',
    {
      mode: WorkMode;
      commuteMinutesOneWay: number; // 30 for WFH, e.g. 45 for WFO
    }
  >;
  modalities: [
    'KICKBOXING',
    'BJJ',
    'UPPER_HYPERTROPHY',
    'LOWER_STRENGTH',
    'BOXING_CONDITIONING',
    'KB_CONDITIONING',
    'DUT',
    'TRX',
    'AB_ASSAULT',
    'MOBILITY_RECOVERY'
  ];
  dietaryPreference: DietPreference;
  targetDailyProteinGrams: number;
}
```

### B. Lift History & Progressive Overload Schema
```typescript
export interface ExerciseSetRecord {
  setNumber: number;
  weight: number;
  unit: WeightUnit;
  repsCompleted: number;
  rpe?: number; // Rate of Perceived Exertion (1-10 scale)
}

export interface LiftRecord {
  date: string;         // YYYY-MM-DD (IST)
  exerciseName: string; // e.g. "Barbell Back Squat"
  sets: ExerciseSetRecord[];
  notes?: string;
}

// Persisted under Redis Key: `athlete:lifts:{userId}` (TTL: 90 days)
export interface AthleteLiftHistory {
  userId: string;
  updatedAt: string;
  history: LiftRecord[];
}
```

---

## 4. Periodization & Replanning Heuristics

The agent's system prompt must enforce the following athletic reasoning rules:

1. **Combat Priority:** Lock in the 2 combat sports sessions (Kickboxing & BJJ) first based on verified gym class slots.
2. **Commute & Energy Allocation:**
   - **WFH Days (Low friction, high recovery):** Allocate high-demand sessions (Hard Sparring, Heavy Lower Body, High-Volume S&C) or early evening sessions. Prioritize standalone heavy compound movements with full rest (2–3 min).
   - **WFO Days (High commute friction):** Allocate shorter, high-density sessions (TRX, Ab Assault, Boxing Conditioning) or prioritize **Antagonistic Supersets** (e.g. Push + Pull labeled as `A1/A2`) to finish in 35–45 minutes, or designate as Active Recovery/Rest.
   - **Weekends (Flexible timing):** Allocate sessions only if a day from the week has been missed or on user request. Allocate only morning sessions for Saturday; Sunday has to be excluded completely.
3. **Weekly Volume & Progressive Overload Distribution (The 3 Remaining Days):**
   - Must balance Push/Pull/Leg strength with metabolic conditioning.
   - **Main Compounds (Squat, Deadlift, Bench, Overhead Press):** Linear micro-loading (+2.5 kg or +5 lbs) once target sets and reps are achieved at target RPE.
   - **Accessory & Hypertrophy:** Double progression model (hold weight steady until reaching upper bound of rep range across all sets, e.g., $3 \times 12$, then increase load).
   - **Auto-Regulation / Deload:** Drop load by 10–15% or cut 1 set if preceding combat session caused high systemic fatigue or if athlete reports RPE $\ge 9.5$.
4. **Nutrition Alignment:**
   - **Combat / Heavy Lift Days:** Higher peri-workout complex carbs (40–60g) 90–120 mins pre-training and 35–40g protein post-training + electrolyte replenishment.
   - **Rest / WFO Days:** Baseline protein distribution ($4 \times 30\text{g}$ meals) without excess carbohydrate loading.
5. **Mid-Week Cancellation Handling:**
   - If a scheduled class is flagged as `CANCELLED` in `WeeklyScheduleStore.diffs`, the agent replans that specific day into an alternative open-floor workout (e.g., Heavy Bag drills + KB complex) or swaps it with another day's strength session.

---

## 5. Tool Definitions (Function Calling Schema)

### Tool 1: `replan_week_schedule`
Called when the user asks for their weekly plan, when a schedule diff is detected, or when unforeseen disruptions (illness, work overtime, missed gym session) occur.

```typescript
export const replanWeekScheduleTool = {
  name: 'replan_week_schedule',
  description: 'Generates or modifies the weekly 7-day athletic workout and recovery plan with progressive overload targets, supersets, and nutrition.',
  parameters: {
    type: 'OBJECT',
    properties: {
      plan: {
        type: 'ARRAY',
        description: 'The 7-day plan from Monday through Sunday.',
        items: {
          type: 'OBJECT',
          properties: {
            date: { type: 'STRING', description: 'YYYY-MM-DD format (IST)' },
            day: { type: 'STRING', description: 'Monday, Tuesday, etc.' },
            focus: { 
              type: 'STRING', 
              description: 'Primary session objective (e.g., "BJJ + Grip Conditioning", "Upper Hypertrophy (Supersets)")' 
            },
            modality: { 
              type: 'STRING',
              enum: [
                'KICKBOXING', 'BJJ', 'UPPER_HYPERTROPHY', 'LOWER_STRENGTH',
                'BOXING_CONDITIONING', 'KB_CONDITIONING', 'DUT', 'TRX', 
                'AB_ASSAULT', 'MOBILITY_RECOVERY', 'REST'
              ]
            },
            isGymClass: { type: 'BOOLEAN', description: 'True if mapped to a scheduled gym class' },
            gymSlotId: { type: 'STRING', description: 'Slot ID from gym schedule if isGymClass is true', nullable: true },
            plannedTime: { type: 'STRING', description: 'HH:mm (24-hr IST)' },
            estimatedDurationMinutes: { type: 'NUMBER' },
            exercises: {
              type: 'ARRAY',
              description: 'Prescribed exercises with progressive overload targets and optional superset groupings.',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING', description: 'e.g. "Barbell Bench Press", "Dumbbell Row"' },
                  sets: { type: 'NUMBER', description: 'Number of working sets' },
                  reps: { type: 'STRING', description: 'Target rep scheme (e.g. "5", "8-10", "AMRAP")' },
                  targetWeight: { type: 'NUMBER', description: 'Prescribed weight value based on history', nullable: true },
                  unit: { type: 'STRING', enum: ['KG', 'LBS'] },
                  targetRpe: { type: 'NUMBER', description: 'Target RPE (1-10 scale)', nullable: true },
                  restSeconds: { type: 'NUMBER', description: 'Rest period in seconds after this set/exercise' },
                  supersetGroupId: { 
                    type: 'STRING', 
                    description: 'Short identifier like "A" or "B" for exercises done back-to-back. Null if standalone.', 
                    nullable: true 
                  },
                  orderInGroup: { 
                    type: 'NUMBER', 
                    description: 'Order within the superset (e.g. 1 for A1, 2 for A2)', 
                    nullable: true 
                  },
                  progressionNote: { type: 'STRING', description: 'Progression directive (e.g. "+5 lbs over last week")' }
                },
                required: ['name', 'sets', 'reps', 'unit', 'restSeconds']
              }
            },
            nutritionAdvice: {
              type: 'STRING',
              description: 'Specific pre/post workout fuel recommendation based on session demand.'
            }
          },
          required: ['date', 'day', 'focus', 'modality', 'isGymClass', 'plannedTime', 'exercises', 'nutritionAdvice']
        }
      },
      reasoning: {
        type: 'STRING',
        description: 'Clear coaching explanation of why this split was selected given the work schedule, fatigue, and gym timetable.'
      }
    },
    required: ['plan', 'reasoning']
  }
};
```

### Tool 2: `log_lift_performance`
Called when the user completes a weight training workout to update historical performance records.

```typescript
export const logLiftPerformanceTool = {
  name: 'log_lift_performance',
  description: 'Logs completed weight lifting sets, reps, load, and unit to maintain progressive overload records.',
  parameters: {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING', description: 'YYYY-MM-DD (IST)' },
      exerciseName: { type: 'STRING', description: 'Exercise name matching standard movement library' },
      unit: { type: 'STRING', enum: ['KG', 'LBS'] },
      sets: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            setNumber: { type: 'NUMBER' },
            weight: { type: 'NUMBER' },
            repsCompleted: { type: 'NUMBER' },
            rpe: { type: 'NUMBER', nullable: true }
          },
          required: ['setNumber', 'weight', 'repsCompleted']
        }
      },
      notes: { type: 'STRING', description: 'Observations on form, velocity, or joint fatigue.', nullable: true }
    },
    required: ['date', 'exerciseName', 'unit', 'sets']
  }
};
```

### Tool 3: `log_athlete_event`
Called when the user informs the agent about a health or schedule disruption mid-conversation.

```typescript
export const logAthleteEventTool = {
  name: 'log_athlete_event',
  description: 'Logs an unexpected constraint such as illness, acute soreness, travel, or missed workout.',
  parameters: {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING', description: 'YYYY-MM-DD IST' },
      type: { 
        type: 'STRING', 
        enum: ['ILLNESS', 'MISSED_SESSION', 'SORENESS_OVERLOAD', 'TRAVEL_WORK'] 
      },
      severity: { type: 'STRING', enum: ['MILD', 'MODERATE', 'SEVERE'] },
      notes: { type: 'STRING', description: 'Details reported by user.' }
    },
    required: ['date', 'type', 'severity', 'notes']
  }
};
```

---

## 6. Execution Flow & Context Assembly

```
1. Ingest Request -> (User message + User Profile + Current Date/Time in IST)
2. Retrieve Redis State (Parallel Fetch):
   ├── WeeklyScheduleStore: schedule:week:{YYYY_Www} (Slots + Diffs)
   ├── AthleteProfile: athlete:profile:{userId}
   ├── Lift History: athlete:lifts:{userId}
   └── Active Week Plan: plan:week:{YYYY_Www}
3. Assemble System Prompt:
   - System Persona & Grounding Rules
   - User Profile (Weight, WFH/WFO per day, commute, Unit Preference)
   - Current Gym Timetable (Available slots)
   - Active Diffs (Cancellations/shifts)
   - Recent Athlete Event Logs & Lift Baseline
   - Tool Declarations (replan_week_schedule, log_lift_performance, log_athlete_event)
4. Execute LLM Call (Google GenAI Gemini 2.5/3 with Tool Definitions)
5. Handle Tool Call:
   - If `replan_week_schedule`: Save new plan to Redis (`plan:week:{YYYY_Www}`) and stream response to user.
   - If `log_lift_performance`: Append lift sets to Redis (`athlete:lifts:{userId}`) and acknowledge.
   - If `log_athlete_event`: Record event and evaluate whether a replan is needed.
   - If plain chat response: Stream conversational advice directly.
```

---

## 7. Acceptance Criteria
- [ ] Agent correctly triggers `replan_week_schedule` with a fully formed 7-day plan when requested.
- [ ] Prescribes structured exercises with explicit `sets`, `reps`, `targetWeight`, `unit` (`KG`/`LBS`), and `progressionNote`.
- [ ] Supports superset grouping via `supersetGroupId` and `orderInGroup` on time-constrained (WFO) days.
- [ ] Integrates past lift history from Redis to calculate micro-loading increases on compound movements.
- [ ] BJJ and Kickboxing sessions are mapped strictly to valid timetable slots.
- [ ] Work-from-office (WFO) days receive lower-friction training volumes compared to WFH days.
- [ ] Saturday is scheduled only for morning sessions if a weekday was missed; Sunday is strictly excluded.
- [ ] Illness or missed session reports trigger automated recovery replanning.
- [ ] All dates and times strictly adhere to 24-hr format and `Asia/Kolkata` IST timezone.