/**
 * @file src/app/api/auth/webauthn/login/verify/route.ts
 * @description Verifies WebAuthn assertion signature, authenticates the athlete, and issues the session cookie.
 */

import { NextResponse, type NextRequest } from "next/server";
import { WebAuthnLoginVerifyInputSchema } from "@/types/webauthn";
import {
  parseClientData,
  verifyAssertionSignature,
} from "@/lib/webauthn";
import {
  getAndClearWebAuthnChallenge,
  getPasskeyCredential,
  savePasskeyCredential,
} from "@/lib/redis";
import { setSessionCookie } from "@/lib/session";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = WebAuthnLoginVerifyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { id, response } = parsed.data;

  // 1. Look up stored credential
  const credential = await getPasskeyCredential(id);
  if (!credential) {
    return NextResponse.json(
      { error: "CREDENTIAL_NOT_FOUND" },
      { status: 401 }
    );
  }

  // 2. Parse clientDataJSON & verify challenge
  let clientData: { type: string; challenge: string; origin: string };
  try {
    clientData = parseClientData(response.clientDataJSON);
  } catch {
    return NextResponse.json({ error: "INVALID_CLIENT_DATA" }, { status: 400 });
  }

  if (clientData.type !== "webauthn.get") {
    return NextResponse.json({ error: "INVALID_CLIENT_DATA_TYPE" }, { status: 400 });
  }

  const expectedChallenge = await getAndClearWebAuthnChallenge(`login:${clientData.challenge}`);
  if (!expectedChallenge || expectedChallenge !== clientData.challenge) {
    return NextResponse.json({ error: "INVALID_OR_EXPIRED_CHALLENGE" }, { status: 401 });
  }

  // 3. Cryptographically verify signature
  const isSignatureValid = verifyAssertionSignature({
    publicKeySpkiBase64: credential.publicKey,
    authenticatorDataBase64: response.authenticatorData,
    clientDataJSONBase64: response.clientDataJSON,
    signatureBase64: response.signature,
  });

  if (!isSignatureValid) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  // 4. Update credential sign counter
  credential.counter += 1;
  await savePasskeyCredential(credential);

  // 5. Issue session cookie
  const res = NextResponse.json(
    { ok: true, userId: credential.userId },
    { status: 200 }
  );

  await setSessionCookie(res, {
    userId: credential.userId,
    role: "MEMBER",
  });

  return res;
}
