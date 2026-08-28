# GymFlow 🥊
> Adaptive, agentic strength & MMA conditioning copilot synchronized with live gym scheduling.

GymFlow is an open-source AI coaching copilot designed for combat sports athletes and strength training. Unlike static workout trackers, GymFlow bridges real-time third-party gym class schedules with a stateful LLM orchestrator. It adapts your weekly periodization on the fly based on real-life friction: mid-week gym class cancellations, daily work-from-home/office commute shifts, systemic fatigue, and unexpected illness.

---

## ⚡ Key Highlights & Architecture

- **Reverse-Engineered Third-Party Ingestion:** Secure backend OTP authentication bridge with 24-hour token delegation into Upstash Redis (zero token leakage to the client).
- **Dynamic Mid-Week Schedule Diffing:** Ingests live timetable endpoints, compares against weekly Redis state snapshots, and alerts the context engine to slot cancellations.
- **Stateful Agentic Replanning:** Implements deterministic tool calling (`replan_week_schedule`, `log_constraint`) via Gemini Pro/Flash rather than brittle text generation.
- **Spec-Driven & Zero-Cost Serverless:** Engineered entirely on Next.js 15 App Router, TypeScript strict mode, Zod boundary enforcement, and serverless edge compute ($0/mo operating footprint).
- **Offline Mock Adapter:** Full local testability and public demo support using sanitized JSON fixtures (`USE_MOCK_GYM=true`).

---

## 🏗️ System Architecture

```text
[ Next.js 15 App Router (Frontend UI + Edge API) ]
                 │
                 ▼ (HttpOnly Session)
┌──────────────────────────────────────────────────────────────┐
│ BACKEND SERVICES & ORCHESTRATION                             │
├──────────────────────────────────────────────────────────────┤
│ 1. Auth Bridge       ──► Proxies OTP / Exchanges Bearer JWT  │
│ 2. Gym Ingestion     ──► Fetches /member/schedules/by-tier   │
│ 3. Diff Engine       ──► Detects mid-week class shifts       │
│ 4. Agent Tool Runner ──► Executes structured LLM tool calls  │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
               ▼                               ▼
     [ Upstash Redis ]               [ Google GenAI SDK ]
  (Tokens, Cache, Snapshots)         (Gemini 2.5/3 Pro & Flash)
```

---

## 🛠️ Tech Stack

- **Framework:** Next.js 15 (App Router, React Server Components)
- **Language:** TypeScript (Strict Mode, zero `any`)
- **State & Caching:** Upstash Redis (REST-based edge client)
- **AI Orchestration:** Google GenAI SDK (Structured Outputs & Tool Calling)
- **Validation:** Zod (Runtime boundary enforcement)
- **Styling:** Tailwind CSS

---

## 📁 Repository Structure

```text
.
├── AGENTS.md                  # Project rules & constraints for AI coding agents
├── fixtures/                  # Sanitized mock JSON payloads for offline dev & CI
│   ├── raw-auth-response.json
│   └── raw-schedules-response.json
├── specs/                     # Spec-Driven Development (SDD) architectural blueprints
│   ├── 01-contracts.md
│   ├── 02-auth-and-client.md
│   ├── 03-schedule-ingest.md
│   └── 04-agent-engine.md
├── evals/                     # Deterministic LLM evaluation scenarios & test harness
│   └── test-scenarios.json
├── src/
│   ├── app/                   # Next.js App Router pages and API routes
│   ├── lib/                   # Gym client adapters, Redis cache, agent tools
│   └── types/                 # Zod schemas and TypeScript data contracts
└── scripts/                   # Evaluation runners and test scripts
```

---

## 🚀 Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/your-username/gymflow.git
cd gymflow
pnpm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Fill in the required credentials:
```env
# Gym Provider Configuration (Use mock mode for offline dev)
USE_MOCK_GYM=true
GYM_API_BASE_URL="https://api.your-gym-provider.com"

# Upstash Redis
UPSTASH_REDIS_REST_URL="https://your-redis-instance.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your_redis_token"

# LLM Provider
GEMINI_API_KEY="your_google_ai_studio_key"

# App Security
SESSION_SECRET="generate_a_random_32_byte_secret"
```

### 3. Run Locally
```bash
pnpm dev
```
Open `http://localhost:3000` to interact with the coaching copilot.

---

## 🧪 Running Agent Evals
To evaluate the LLM's dynamic replanning logic against deterministic test cases:
```bash
pnpm test:evals
```

---

## 📄 License
MIT