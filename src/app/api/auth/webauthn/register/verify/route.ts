/**
 * @file src/app/api/auth/webauthn/register/verify/route.ts
 * @description Verifies WebAuthn registration response and persists the athlete's passkey credential.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { WebAuthnRegisterVerifyInputSchema } from "@/types/webauthn";
import {
  parseClientData,
  resolveSpkiPublicKey,
} from "@/lib/webauthn";
import {
  getAndClearWebAuthnChallenge,
  savePasskeyCredential,
} from "@/lib/redis";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = WebAuthnRegisterVerifyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { id, response, deviceName } = parsed.data;

  // 1. Verify challenge
  const expectedChallenge = await getAndClearWebAuthnChallenge(`reg:${session.userId}`);
  if (!expectedChallenge) {
    return NextResponse.json(
      { error: "CHALLENGE_EXPIRED_OR_NOT_FOUND" },
      { status: 400 }
    );
  }

  let clientData: { type: string; challenge: string; origin: string };
  try {
    clientData = parseClientData(response.clientDataJSON);
  } catch {
    return NextResponse.json({ error: "INVALID_CLIENT_DATA" }, { status: 400 });
  }

  if (clientData.type !== "webauthn.create") {
    return NextResponse.json({ error: "INVALID_CLIENT_DATA_TYPE" }, { status: 400 });
  }

  if (clientData.challenge !== expectedChallenge) {
    return NextResponse.json({ error: "CHALLENGE_MISMATCH" }, { status: 400 });
  }

  // 2. Resolve public key to SPKI DER
  let keyInfo: { spkiBase64: string; algorithm: number };
  try {
    keyInfo = resolveSpkiPublicKey({
      publicKeyBase64: response.publicKey,
      attestationObjectBase64: response.attestationObject,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to parse public key";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // 3. Persist credential
  await savePasskeyCredential({
    credentialId: id,
    userId: session.userId,
    publicKey: keyInfo.spkiBase64,
    publicKeyAlgorithm: response.publicKeyAlgorithm ?? keyInfo.algorithm,
    counter: 0,
    createdAt: new Date().toISOString(),
    deviceName: deviceName || "Biometric Authenticator",
  });

  return NextResponse.json(
    { ok: true, message: "Biometrics successfully registered." },
    { status: 200 }
  );
}
