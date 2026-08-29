/**
 * @file src/lib/session.ts
 * @spec SPEC-002 – Auth & Token Management
 *
 * Internal JWT session helpers built on `jose`.
 *
 * The session cookie carries ONLY { userId, role } — the gym Bearer token
 * is stored exclusively in Redis and is NEVER included in the cookie payload.
 *
 * Cookie settings:
 *   - HttpOnly   – inaccessible to JavaScript
 *   - Secure     – HTTPS-only in production
 *   - SameSite=Lax – balanced CSRF protection
 *   - Path=/     – available across the app
 *   - MaxAge     – mirrors the Redis TTL (82 800 s)
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { type NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cookie name; controlled by env so it can be namespaced per environment. */
const COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ?? "gymflow_session";

/** 23-hour session lifetime in seconds – matches the Redis TTL. */
const SESSION_MAX_AGE = 82_800;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the claims we put inside the signed session JWT. */
export interface SessionPayload extends JWTPayload {
  userId: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Retrieves and validates the SESSION_JWT_SECRET env var.
 * Encoded to a `Uint8Array` as required by jose's HMAC signing.
 */
function getSigningKey(): Uint8Array {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_JWT_SECRET is not set. " +
        "Generate with: openssl rand -hex 32",
    );
  }
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Signs an internal session JWT containing `userId` and `role`.
 * Uses HMAC-SHA256 (HS256). Expires in 23 hours.
 */
export async function signSessionToken(
  payload: Omit<SessionPayload, keyof JWTPayload>,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSigningKey());
}

/**
 * Verifies and decodes a session JWT.
 * Throws if the token is invalid or expired.
 */
export async function verifySessionToken(
  token: string,
): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getSigningKey(), {
    algorithms: ["HS256"],
  });
  return payload as SessionPayload;
}

/**
 * Reads the session cookie from an incoming `Request`.
 * Returns `null` if the cookie is absent or the JWT is invalid/expired.
 */
export async function getSessionFromRequest(
  request: Request,
): Promise<SessionPayload | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieValue = parseCookie(cookieHeader, COOKIE_NAME);

  if (!cookieValue) return null;

  try {
    return await verifySessionToken(cookieValue);
  } catch {
    return null;
  }
}

/**
 * Attaches an HttpOnly session cookie to a `NextResponse`.
 *
 * @param response - The response to mutate.
 * @param payload  - Session claims to embed in the JWT.
 */
export async function setSessionCookie(
  response: NextResponse,
  payload: Omit<SessionPayload, keyof JWTPayload>,
): Promise<void> {
  const token = await signSessionToken(payload);
  const isProduction = process.env.NODE_ENV === "production";

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Clears the session cookie on a response (logout).
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Minimal `Cookie` header parser — avoids a runtime dependency. */
function parseCookie(header: string, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}
