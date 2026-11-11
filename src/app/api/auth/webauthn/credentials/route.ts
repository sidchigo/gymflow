/**
 * @file src/app/api/auth/webauthn/credentials/route.ts
 * @description Removes registered biometric credentials for the authenticated athlete.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { deleteUserPasskeys, deletePasskeyCredential } from "@/lib/redis";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(request.url);
  const credentialId = url.searchParams.get("id");

  if (credentialId) {
    await deletePasskeyCredential(session.userId, credentialId);
  } else {
    await deleteUserPasskeys(session.userId);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
