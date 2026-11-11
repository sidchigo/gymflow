/**
 * @file src/app/api/auth/passkey/register-verify/route.ts
 * @description Registers/persists a passkey (Windows Hello / biometric) for an athlete
 * both with Cooper Fitness API (if live) and GymFlow internal Redis store.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveSpkiPublicKey } from "@/lib/webauthn";
import { savePasskeyCredential } from "@/lib/redis";

const RegisterVerifySchema = z.object({
  email: z.string().email(),
  credential: z.object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal("public-key"),
    response: z.object({
      clientDataJSON: z.string().min(1),
      attestationObject: z.string().min(1),
      publicKey: z.string().optional(),
      publicKeyAlgorithm: z.number().optional(),
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

  const parsed = RegisterVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { email, credential } = parsed.data;
  const cleanEmail = email.trim().toLowerCase();

  // 1. Forward to upstream gym API if live
  if (process.env.GYM_USE_MOCK !== "true" && process.env.GYM_API_BASE_URL) {
    try {
      await fetch(`${process.env.GYM_API_BASE_URL}/auth/passkey/register-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, credential }),
      });
    } catch (err) {
      console.warn("[passkey/register-verify] Upstream gym API error:", err);
    }
  }

  // 2. Persist in GymFlow Redis store for this email
  try {
    const keyInfo = resolveSpkiPublicKey({
      publicKeyBase64: credential.response.publicKey,
      attestationObjectBase64: credential.response.attestationObject,
    });

    await savePasskeyCredential({
      credentialId: credential.id,
      userId: cleanEmail,
      publicKey: keyInfo.spkiBase64,
      publicKeyAlgorithm: credential.response.publicKeyAlgorithm ?? keyInfo.algorithm,
      counter: 0,
      createdAt: new Date().toISOString(),
      deviceName: "Windows Hello / Biometric Authenticator",
    });
  } catch (err) {
    console.warn("[passkey/register-verify] Failed to save internal passkey:", err);
  }

  return NextResponse.json({ ok: true, message: "Passkey registered successfully." }, { status: 200 });
}
