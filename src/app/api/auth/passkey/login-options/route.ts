/**
 * @file src/app/api/auth/passkey/login-options/route.ts
 * @description Matches Cooper Fitness gym API passkey flow:
 * Checks if passkey is available for email; if available, returns WebAuthn options for Windows Hello;
 * if not available, triggers OTP request and returns passkey_available: false.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getGymClient } from "@/lib/gym-client";
import { generateChallenge } from "@/lib/webauthn";
import { storeWebAuthnChallenge, getUserPasskeys } from "@/lib/redis";

const InputSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const emailParam = url.searchParams.get("email");

  let email: string;
  if (emailParam) {
    email = emailParam;
  } else {
    try {
      const body = (await request.json()) as { email?: string };
      email = body?.email || "";
    } catch {
      return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
    }
  }

  const parsed = InputSchema.safeParse({ email });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }

  const cleanEmail = parsed.data.email.trim().toLowerCase();
  const currentHost = url.hostname;

  // 1. Check if upstream live gym API has passkey available
  if (process.env.GYM_USE_MOCK !== "true" && process.env.GYM_API_BASE_URL) {
    try {
      const gymRes = await fetch(
        `${process.env.GYM_API_BASE_URL}/auth/passkey/login-options?email=${encodeURIComponent(cleanEmail)}`,
        { method: "POST" }
      );

      if (gymRes.ok) {
        const gymData = (await gymRes.json()) as {
          passkey_available: boolean;
          publicKey?: {
            challenge: string;
            allowCredentials?: Array<{ id: string; type: "public-key" }>;
            rpId?: string;
            timeout?: number;
            userVerification?: string;
          };
        };

        if (gymData.passkey_available && gymData.publicKey) {
          // If running on current origin, adapt rpId if needed
          return NextResponse.json({
            passkey_available: true,
            source: "gym_api",
            publicKey: {
              ...gymData.publicKey,
              rpId: currentHost.includes("thecooperfitness.com")
                ? gymData.publicKey.rpId || "gymwebapp.thecooperfitness.com"
                : currentHost,
            },
          });
        }
      }
    } catch (err) {
      console.warn("[passkey/login-options] Upstream gym API error:", err);
    }
  }

  // 2. Check internal Redis passkey store for this email
  const internalPasskeys = await getUserPasskeys(cleanEmail);
  if (internalPasskeys.length > 0) {
    const challenge = generateChallenge();
    await storeWebAuthnChallenge(`login:${cleanEmail}:${challenge}`, challenge, 300);

    return NextResponse.json({
      passkey_available: true,
      source: "internal",
      publicKey: {
        challenge,
        timeout: 60000,
        rpId: currentHost,
        userVerification: "preferred",
        allowCredentials: internalPasskeys.map((p) => ({
          id: p.credentialId,
          type: "public-key",
        })),
      },
    });
  }

  // 3. Passkey not available for this email -> Automatically send OTP
  try {
    const client = await getGymClient();
    await client.requestOtp(cleanEmail);
    return NextResponse.json({
      passkey_available: false,
      otpSent: true,
      message: "Check your email for the one-time code.",
    });
  } catch (err: unknown) {
    console.error("[passkey/login-options] Failed to request OTP:", err);
    return NextResponse.json(
      { passkey_available: false, otpSent: false, error: "Failed to send OTP" },
      { status: 500 }
    );
  }
}

