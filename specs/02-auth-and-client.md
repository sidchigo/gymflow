# SPEC-002: Gym Authentication Bridge & Token Management

## 1. Context & Goal
Provide a secure backend proxy to authenticate users against the Gym API via email OTP and maintain a secure 23-hour session.

## 2. Invariants & Guardrails
- **CRITICAL:** Third-party gym tokens MUST NOT be passed to or stored on the browser.
- **CRITICAL:** Client interactions authenticate via an encrypted `HttpOnly` cookie session.
- **Forbidden:** No external dependencies other than `@upstash/redis` and `jose` for auth handling.

## 3. Interfaces & Schemas
- **Input:** `POST /api/auth/send-otp` -> `{ email: string }`
- **Input:** `POST /api/auth/verify-otp` -> `{ email: string, otp: string }`
- **Redis State Schema:**
  - Key: `session:{userId}:gym_token`
  - Value: `string` (JWT Bearer Token)
  - TTL: `82800` (23 hours to stay safely within the 24-hour expiry)

## 4. Sequence Flow
1. Client calls `POST /api/auth/send-otp` with email.
2. Server forwards request to `${process.env.GYM_API_BASE_URL}/member/login/request-otp` with email as query string.
3. Client receives OTP in mail and calls `POST /api/auth/verify-otp`.
4. Server forwards request to `${process.env.GYM_API_BASE_URL}/member/login/verify-otp` with email and OTP as query string, extracts `access_token`, `user_id` and `role`.
5. Server writes `access_token` to Upstash Redis with 23-hour TTL.
6. Server signs an internal JWT containing `userId`, `role` and sets an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie.

## 5. Error Handling
- **Invalid OTP:** Return `401 Unauthorized` with `{ error: "INVALID_OTP" }`.
- **Gym API Timeout (504):** Return `502 Bad Gateway` with `{ error: "GYM_SERVICE_UNAVAILABLE" }`.

## 6. Acceptance Criteria
- [ ] User can request an OTP via email successfully.
- [ ] Submitting a valid OTP sets an `HttpOnly` session cookie on the client response.
- [ ] Gym Bearer token is verified inside Redis with an active TTL.
- [ ] Direct token leakage to client response payload is strictly zero.