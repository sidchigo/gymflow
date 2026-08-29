# SPEC-001: Data Contracts & Schema Validation

## 1. Context & Goal
- **Problem:** Raw responses from third-party gym APIs contain extraneous metadata (WebAuthn challenges, passkey configs, UI styling tags) that bloat context and introduce security risks.
- **Goal:** Define strict Zod schemas to validate incoming payloads and produce compact, strongly-typed internal data structures in `src/types/gym.ts`.

## 2. Invariants & Guardrails
- **Ground Truth:** Base schemas strictly on the actual JSON structure in `fixtures/raw-auth-response.json` and `fixtures/raw-schedules-response.json`.
- **No Hallucinated Fields:** Do not invent keys. If a field is not present in the fixtures, do not add it to the parser.
- **Strict Normalization:** Strip all WebAuthn/Passkey fields (`publicKey`, `passkey_registration`, `challenges`, `allowCredentials`) during transformation.
- **Output Target:** All schemas and inferred TypeScript types must reside in `src/types/gym.ts`.

## 3. Required Schemas & Transformations

### A. Auth Schemas
1. `RequestOtpInputSchema`: Validates `{ email: string }`.
2. `VerifyOtpInputSchema`: Validates `{ email: string, otp: string }`.
3. `RawAuthResponseSchema`: Validates the raw OTP verification response (`access_token`, `user_id`, `role`).
4. `AuthSessionSchema`: Clean internal session state:
   - `userId: string`
   - `role: string`
   - `accessToken: string`

### B. Gym Schedule Schemas
1. `RawScheduleResponseSchema`: Validates the raw schedule array/payload from `fixtures/raw-schedules-response.json`.
2. `NormalizedGymSlotSchema`: Compact, LLM-ready slot representation:
   - `id: string`
   - `day: string` (e.g., "Monday")
   - `startTime: string` (e.g., "07:00")
   - `endTime: string` (e.g., "08:00")
   - `title: string` (e.g., "Muay Thai Fundamentals")
   - `trainer: string`

### C. Schedule Normalizer Function Contract
- Define `normalizeSchedulePayload(raw: unknown): NormalizedGymSlot[]` using safe Zod parsing (`safeParse`).

## 4. Error Handling & Edge Cases
- **Schema Validation Failure:** If third-party API changes payload shape, `safeParse` must throw a custom `ValidationError` with detailed Zod issue paths.
- **Empty / Null Schedules:** If the schedule data array is empty or null, return an empty array `[]` without crashing.

## 5. Acceptance Criteria
- [ ] `src/types/gym.ts` exports all required Zod schemas and inferred TypeScript types.
- [ ] Zod schemas successfully validate both `fixtures/raw-auth-response.json` and `fixtures/raw-schedules-response.json`.
- [ ] The `normalizeSchedulePayload` transformer discards all unused third-party boilerplate.
- [ ] `npm tsc --noEmit` passes with zero errors.