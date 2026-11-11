/**
 * @file src/types/webauthn.ts
 * @description Zod schemas and TypeScript interfaces for WebAuthn Biometric Authentication (Passkeys).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Stored Credential Model
// ---------------------------------------------------------------------------

export const StoredPasskeyCredentialSchema = z.object({
  credentialId: z.string().min(1),
  userId: z.string().min(1),
  publicKey: z.string().min(1), // Base64-encoded SPKI DER public key
  publicKeyAlgorithm: z.number().int(),
  counter: z.number().int().nonnegative().default(0),
  createdAt: z.string().min(1),
  deviceName: z.string().optional(),
});

export type StoredPasskeyCredential = z.infer<typeof StoredPasskeyCredentialSchema>;

// ---------------------------------------------------------------------------
// 2. Registration Schemas
// ---------------------------------------------------------------------------

export const WebAuthnRegisterOptionsSchema = z.object({
  challenge: z.string().min(1),
  rp: z.object({
    name: z.string(),
    id: z.string().optional(),
  }),
  user: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    displayName: z.string().min(1),
  }),
  pubKeyCredParams: z.array(
    z.object({
      type: z.literal("public-key"),
      alg: z.number().int(),
    })
  ),
  timeout: z.number().int().positive(),
  authenticatorSelection: z.object({
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
    userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
    residentKey: z.enum(["required", "preferred", "discouraged"]).optional(),
  }).optional(),
});

export type WebAuthnRegisterOptions = z.infer<typeof WebAuthnRegisterOptionsSchema>;

export const WebAuthnRegisterVerifyInputSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
    publicKey: z.string().optional(),
    publicKeyAlgorithm: z.number().optional(),
  }),
  deviceName: z.string().optional(),
});

export type WebAuthnRegisterVerifyInput = z.infer<typeof WebAuthnRegisterVerifyInputSchema>;

// ---------------------------------------------------------------------------
// 3. Login / Assertion Schemas
// ---------------------------------------------------------------------------

export const WebAuthnLoginOptionsSchema = z.object({
  challenge: z.string().min(1),
  timeout: z.number().int().positive(),
  rpId: z.string().optional(),
  userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
  allowCredentials: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("public-key"),
      })
    )
    .optional(),
});

export type WebAuthnLoginOptions = z.infer<typeof WebAuthnLoginOptionsSchema>;

export const WebAuthnLoginVerifyInputSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().optional(),
  }),
});

export type WebAuthnLoginVerifyInput = z.infer<typeof WebAuthnLoginVerifyInputSchema>;

