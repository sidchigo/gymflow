# SPEC-005: Mobile-First UI Layout, Week-Strip & AI Coach Deck

## 1. Context & Goal
- **Problem:** When training on the gym floor or commuting, athletes interact via smartphones. Desktop split-screens cause cramped views and poor ergonomics on mobile viewports.
- **Goal:** Build a sleek, **mobile-first** Next.js 15 PWA-ready dashboard featuring a thumb-accessible horizontal Week Strip, expandable daily workout cards (with superset brackets and RPE inputs), and a gesture-driven/tabbed AI Coach Chat.

---

## 2. Mobile-First Layout & Ergonomics

- **Primary Viewport (Mobile < 768px):**
  - **Sticky Top Bar:** Compact week selector (`W35 • Aug 24 - 30`), WFH/WFO chip, and Gym Timetable Sync button.
  - **Horizontal Date Strip (Carousel/Pill Selector):** Monday–Sunday pills with dot indicators for workout status (Combat, Strength, Rest, Cancelled). Tapping a day smoothly centers it and switches the active card.
  - **Active Day View:** Single-day scrollable deck showing Session Objective, Gym Class binding badge, Superset-grouped exercise cards, and Peri-workout nutrition advice.
  - **Bottom Floating Action Bar / Sheet:** Persistent "Coach AI" drawer handle with quick chips (`"Log Lift"`, `"Replan"`, `"Cancel Today"`) that slides up into a full-height interactive chat sheet.
- **Desktop/Tablet Progressive Enhancement (≥ 1024px):**
  - Expands into a dual-pane desktop dashboard (Full 7-day calendar matrix on the left, pinned Coach Chat on the right).

---

## 3. Screen Structure & Component Hierarchy

```text
src/app/(dashboard)/
├── layout.tsx                    # Mobile viewport meta, theme color, safe-area-inset padding
└── page.tsx                      # Server Component (RSC Hydrator)

src/components/
├── mobile/
│   ├── header-bar.tsx            # Sticky top bar (Date range, user status, sync trigger)
│   ├── week-strip.tsx            # Horizontal swipeable day selector (Mon-Sun pills)
│   ├── day-card-view.tsx         # Active day container (Modality hero, Nutrition card, Exercise deck)
│   ├── exercise-card.tsx         # Exercise item with superset bracket, sets/reps/unit, and RPE tag
│   └── diff-toast.tsx            # Top alert banner when class cancellations or shifts occur
├── chat/
│   ├── coach-sheet.tsx           # Slide-up mobile bottom sheet / drawer for AI conversation
│   ├── message-stream.tsx        # Scrollable chat feed with streaming tokens
│   ├── chat-input.tsx            # Compact mobile keyboard-friendly input with voice/action chips
│   └── tool-indicator.tsx        # Micro-spinner when agent executes `replan_week_schedule`
└── ui/                           # Base mobile primitives (Tailwind CSS + Lucide icons)
```

---

## 4. Mobile Component Specifications

### A. Sticky Top Header (`src/components/mobile/header-bar.tsx`)
- Height: `h-14` with `env(safe-area-inset-top)` padding.
- Displays current date in IST (`Sat, 29 Aug`), athlete weight badge (`74 kg`), and today's work mode (`WFH 🏡` or `WFO 🏢`).
- Sync button: Minimalist refresh icon that calls `/api/schedules?forceRefresh=true` with haptic-like active state.

### B. Horizontal Week Strip (`src/components/mobile/week-strip.tsx`)
- 7 clickable day cards in a horizontal row (`flex overflow-x-auto no-scrollbar`).
- Each day pill displays:
  - Day abbreviation (`M`, `T`, `W`, `T`, `F`, `S`, `S`).
  - Date number (`24`, `25`, etc.).
  - Dot status:
    - 🟡 Amber dot: Combat sports class (Kickboxing / BJJ).
    - 🔵 Blue dot: Strength / Hypertrophy / Conditioning.
    - ⚪ Muted dot: Rest / Recovery.
    - 🔴 Red dot: Class cancelled alert.
- Selected day has high-contrast background and subtle glow.

### C. Active Day Workout Deck (`src/components/mobile/day-card-view.tsx`)
- **Header Card:**
  - Session title (e.g., `Lower Body Athletic Power`), planned time (`07:00 IST`), and estimated duration (`50 mins`).
  - If `isGymClass: true`, renders verified badge with trainer name.
- **Nutrition Accordion / Card:**
  - Compact pre/post workout fuel pill (e.g., `⚡ Pre: 40g carbs | 🔋 Post: 35g protein`).
- **Exercise List & Supersets:**
  - **Standalone Lifts:** Large readable font for weight and reps (`3 × 5 @ 85 kg • RPE 8`), rest countdown badge (`90s rest`), and progression hint (`+2.5 kg from last week`).
  - **Supersets:** Visual bounding box linking `A1` and `A2` exercises with an indigo border.

### D. Coach Drawer / Bottom Sheet (`src/components/chat/coach-sheet.tsx`)
- Accessible via a floating bottom bar: `💬 Ask Coach / Replan`.
- Swipe-up drawer (using Vaul / Radix Sheet or Framer Motion).
- **Quick Action Pills (Horizontal scroll above input):**
  - `"Feeling sick today"`
  - `"Shift BJJ to evening"`
  - `"Log: Squat 3x5 @ 85kg"`
  - `"Short on time (30 mins)"`
- When `replan_week_schedule` resolves, trigger instant state revalidation so the background calendar updates immediately.

---

## 5. Mobile Visual Design Tokens (Dark Mode Optimized)

| UI Element | Styling & Tailwind Rules | Touch Target / UX |
| :--- | :--- | :--- |
| **Day Pill (Active)** | `bg-zinc-100 text-zinc-950 font-bold shadow-md` | Min height `48px`, easy thumb tap |
| **Day Pill (Inactive)**| `bg-zinc-900/80 text-zinc-400 border border-zinc-800` | Smooth horizontal scroll |
| **WFH Badge** | `bg-emerald-950/60 text-emerald-400 border border-emerald-500/30` | Compact `text-xs px-2 py-0.5` |
| **WFO Badge** | `bg-sky-950/60 text-sky-400 border border-sky-500/30` | Compact `text-xs px-2 py-0.5` |
| **Superset Bracket** | `border-l-4 border-indigo-500 bg-indigo-950/10 rounded-r-lg p-3 my-2` | Visually ties grouped exercises |
| **Cancelled Alert** | `bg-red-950/40 border border-red-500/40 text-red-300` | Immediate visual warning banner |

---

## 6. Acceptance Criteria
- [ ] UI is 100% thumb-friendly on standard mobile screen sizes ($375\text{px} - 430\text{px}$).
- [ ] Horizontal week strip allows instant switching between all 7 days with zero latency.
- [ ] Exercises render clearly with high-contrast sets, reps, weight units (`kg`/`lbs`), and superset brackets (`A1/A2`).
- [ ] AI Coach bottom sheet opens and closes smoothly with zero layout jitter.
- [ ] Tool executions (`replan_week_schedule`) update the active workout deck instantly.
- [ ] Respects mobile viewport safe areas (`env(safe-area-inset-bottom)`).