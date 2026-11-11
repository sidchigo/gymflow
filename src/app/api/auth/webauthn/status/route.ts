/**
 * @file src/app/api/auth/webauthn/status/route.ts
 * @description Retrieves biometric enrollment status and registered passkeys for the authenticated athlete.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getUserPasskeys } from "@/lib/redis";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const passkeys = await getUserPasskeys(session.userId);

  return NextResponse.json(
    {
      enrolled: passkeys.length > 0,
      passkeys: passkeys.map((p) => ({
        id: p.credentialId,
        createdAt: p.createdAt,
        deviceName: p.deviceName || "Biometric Authenticator",
      })),
    },
    { status: 200 }
  );
}
