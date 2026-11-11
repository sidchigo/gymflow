/**
 * @file src/app/api/auth/webauthn/login/options/route.ts
 * @description Generates WebAuthn login assertion options and cryptographic challenge.
 */

import { NextResponse, type NextRequest } from "next/server";
import { generateChallenge } from "@/lib/webauthn";
import { storeWebAuthnChallenge } from "@/lib/redis";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const challenge = generateChallenge();
  await storeWebAuthnChallenge(`login:${challenge}`, challenge, 300);

  const url = new URL(request.url);
  const rpId = process.env.WEBAUTHN_RP_ID || url.hostname;

  const options = {
    challenge,
    timeout: 60000,
    rpId,
    userVerification: "preferred" as const,
  };

  return NextResponse.json(options, { status: 200 });
}
