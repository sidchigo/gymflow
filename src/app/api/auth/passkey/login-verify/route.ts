/**
 * @file src/app/api/auth/passkey/login-verify/route.ts
 * @description Verifies WebAuthn assertion signature (Windows Hello / biometric)
 * against Cooper Fitness API or internal Redis passkey store, then issues the session cookie.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { RawAuthResponseSchema, toAuthSession } from "@/types/gym";
import { storeGymToken, getPasskeyCredential, savePasskeyCredential, getAndClearWebAuthnChallenge } from "@/lib/redis";
import { setSessionCookie } from "@/lib/session";
import { parseClientData, verifyAssertionSignature } from "@/lib/webauthn";

const PasskeyVerifySchema = z.object({
  email: z.string().email(),
  credential: z.object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal("public-key"),
    response: z.object({
      clientDataJSON: z.string().min(1),
      authenticatorData: z.string().min(1),
      signature: z.string().min(1),
      userHandle: z.string().nullable().optional(),
    }),
  }),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = PasskeyVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { email, credential } = parsed.data;
  const cleanEmail = email.trim().toLowerCase();

  // 1. Try verifying with upstream live gym API first (Cooper Fitness)
  if (process.env.GYM_USE_MOCK !== "true" && process.env.GYM_API_BASE_URL) {
    try {
      const gymRes = await fetch(`${process.env.GYM_API_BASE_URL}/auth/passkey/login-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, credential }),
      });

      if (gymRes.ok) {
        const rawAuth = await gymRes.json();
        const parsedAuth = RawAuthResponseSchema.safeParse(rawAuth);

        if (parsedAuth.success) {
          const session = toAuthSession(parsedAuth.data);
          // Store gym Bearer token in Redis (23 hours)
          await storeGymToken(session.userId, session.accessToken);

          const response = NextResponse.json({ ok: true, userId: session.userId }, { status: 200 });
          await setSessionCookie(response, {
            userId: session.userId,
            role: session.role,
          });
          return response;
        }
      }
    } catch (err) {
      console.warn("[passkey/login-verify] Upstream gym API error:", err);
    }
  }

  // 2. Fall back to internal passkey verification
  const storedCred = await getPasskeyCredential(credential.id);
  if (!storedCred) {
    return NextResponse.json({ error: "CREDENTIAL_NOT_FOUND" }, { status: 401 });
  }

  let clientData: { type: string; challenge: string; origin: string };
  try {
    clientData = parseClientData(credential.response.clientDataJSON);
  } catch {
    return NextResponse.json({ error: "INVALID_CLIENT_DATA" }, { status: 400 });
  }

  const challengeKey = `login:${cleanEmail}:${clientData.challenge}`;
  const expectedChallenge = await getAndClearWebAuthnChallenge(challengeKey);
  // Also check without email prefix for compatibility
  const fallbackChallenge = expectedChallenge || (await getAndClearWebAuthnChallenge(`login:${clientData.challenge}`));

  if (!fallbackChallenge || fallbackChallenge !== clientData.challenge) {
    return NextResponse.json({ error: "INVALID_OR_EXPIRED_CHALLENGE" }, { status: 401 });
  }

  const isSignatureValid = verifyAssertionSignature({
    publicKeySpkiBase64: storedCred.publicKey,
    authenticatorDataBase64: credential.response.authenticatorData,
    clientDataJSONBase64: credential.response.clientDataJSON,
    signatureBase64: credential.response.signature,
  });

  if (!isSignatureValid) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  storedCred.counter += 1;
  await savePasskeyCredential(storedCred);

  const response = NextResponse.json({ ok: true, userId: storedCred.userId }, { status: 200 });
  await setSessionCookie(response, {
    userId: storedCred.userId,
    role: "MEMBER",
  });

  return response;
}
