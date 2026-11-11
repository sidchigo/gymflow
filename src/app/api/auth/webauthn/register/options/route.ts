/**
 * @file src/app/api/auth/webauthn/register/options/route.ts
 * @description Generates WebAuthn registration options and cryptographic challenge for an authenticated athlete.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { generateChallenge } from "@/lib/webauthn";
import { storeWebAuthnChallenge } from "@/lib/redis";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const challenge = generateChallenge();
  await storeWebAuthnChallenge(`reg:${session.userId}`, challenge);

  const url = new URL(request.url);
  const rpId = process.env.WEBAUTHN_RP_ID || url.hostname;

  const options = {
    challenge,
    rp: {
      name: "GymFlow",
      id: rpId,
    },
    user: {
      id: Buffer.from(session.userId).toString("base64url"),
      name: session.userId,
      displayName: `Athlete (${session.userId})`,
    },
    pubKeyCredParams: [
      { type: "public-key" as const, alg: -7 },   // ES256 (P-256)
      { type: "public-key" as const, alg: -257 }, // RS256
    ],
    timeout: 60000,
    authenticatorSelection: {
      authenticatorAttachment: "platform" as const,
      userVerification: "preferred" as const,
      residentKey: "preferred" as const,
    },
  };

  return NextResponse.json(options, { status: 200 });
}
