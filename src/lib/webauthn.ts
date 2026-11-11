/**
 * @file src/lib/webauthn.ts
 * @description Cryptographic WebAuthn helper functions for Passkey registration and signature verification.
 * Built strictly on Node.js built-in `node:crypto`.
 */

import crypto from "node:crypto";

/**
 * Standard ASN.1 DER SPKI prefix for an uncompressed P-256 (prime256v1 / secp256r1) EC public key.
 * 30 59: SEQUENCE of 89 bytes
 *   30 13: SEQUENCE (AlgorithmIdentifier)
 *     06 07 2A 86 48 CE 3D 02 01: OID 1.2.840.10045.2.1 (id-ecPublicKey)
 *     06 08 2A 86 48 CE 3D 03 01 07: OID 1.2.840.10045.3.1.7 (secp256r1 / prime256v1)
 *   03 42 00: BIT STRING of 66 bytes (0 unused bits), followed by 0x04 || x (32 bytes) || y (32 bytes).
 */
const P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex"
);

/**
 * Generates a cryptographically secure random base64url challenge.
 */
export function generateChallenge(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

/**
 * Converts a base64url or standard base64 string to a Buffer.
 */
export function base64UrlToBuffer(base64urlStr: string): Buffer {
  return Buffer.from(base64urlStr, "base64url");
}

/**
 * Converts a Buffer to a base64url string.
 */
export function bufferToBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Parses and returns the decoded clientDataJSON payload.
 */
export function parseClientData(clientDataJSONBase64: string): {
  type: string;
  challenge: string;
  origin: string;
} {
  const jsonStr = Buffer.from(clientDataJSONBase64, "base64url").toString("utf-8");
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  return {
    type: typeof parsed.type === "string" ? parsed.type : "",
    challenge: typeof parsed.challenge === "string" ? parsed.challenge : "",
    origin: typeof parsed.origin === "string" ? parsed.origin : "",
  };
}

/**
 * Extracts the public key (SPKI DER format encoded as Base64) from authData or raw public key buffer.
 * If modern browser passes SPKI DER directly via `getPublicKey()`, it validates and returns it.
 * Otherwise, scans authData for the COSE P-256 uncompressed public key.
 */
export function resolveSpkiPublicKey(params: {
  publicKeyBase64?: string | undefined;
  attestationObjectBase64?: string | undefined;
}): { spkiBase64: string; algorithm: number } {
  // 1. If direct SPKI provided by getPublicKey()
  if (params.publicKeyBase64) {
    const rawBuffer = Buffer.from(params.publicKeyBase64, "base64");
    // Validate that it forms a valid KeyObject
    try {
      crypto.createPublicKey({ key: rawBuffer, format: "der", type: "spki" });
      return { spkiBase64: rawBuffer.toString("base64"), algorithm: -7 };
    } catch {
      // Fallback to parsing attestationObject
    }
  }

  // 2. Parse from attestationObject if available
  if (params.attestationObjectBase64) {
    const attestationBuffer = Buffer.from(params.attestationObjectBase64, "base64url");
    // In WebAuthn attestationObject, search for P-256 EC2 key marker (x & y coordinates: each 32 bytes)
    // COSE map keys: -2 (0x21) is x, -3 (0x22) is y for P-256
    const xMarker = Buffer.from([0x21, 0x58, 0x20]); // -2: 32 bytes byte string
    const yMarker = Buffer.from([0x22, 0x58, 0x20]); // -3: 32 bytes byte string

    const xIdx = attestationBuffer.indexOf(xMarker);
    const yIdx = attestationBuffer.indexOf(yMarker);

    if (xIdx !== -1 && yIdx !== -1) {
      const x = attestationBuffer.subarray(xIdx + 3, xIdx + 3 + 32);
      const y = attestationBuffer.subarray(yIdx + 3, yIdx + 3 + 32);

      if (x.length === 32 && y.length === 32) {
        const uncompressedKey = Buffer.concat([Buffer.from([0x04]), x, y]);
        const spkiDer = Buffer.concat([P256_SPKI_PREFIX, uncompressedKey]);
        // Validate key
        crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
        return { spkiBase64: spkiDer.toString("base64"), algorithm: -7 };
      }
    }
  }

  throw new Error("Unable to extract valid public key from WebAuthn credential data.");
}

/**
 * Verifies a WebAuthn authentication assertion signature.
 *
 * WebAuthn signature formula:
 * signedData = authenticatorData || SHA-256(clientDataJSON)
 * Signature verified with SHA-256 against the stored public key.
 */
export function verifyAssertionSignature(params: {
  publicKeySpkiBase64: string;
  authenticatorDataBase64: string;
  clientDataJSONBase64: string;
  signatureBase64: string;
}): boolean {
  try {
    const publicKeyBuffer = Buffer.from(params.publicKeySpkiBase64, "base64");
    const authenticatorData = Buffer.from(params.authenticatorDataBase64, "base64url");
    const clientDataJSON = Buffer.from(params.clientDataJSONBase64, "base64url");
    const signature = Buffer.from(params.signatureBase64, "base64url");

    // 1. Verify authenticatorData flags: UP (User Present - bit 0) MUST be set
    const flags = authenticatorData[32];
    if (flags === undefined || (flags & 0x01) === 0) {
      return false;
    }

    // 2. Hash clientDataJSON with SHA-256
    const clientDataHash = crypto.createHash("sha256").update(clientDataJSON).digest();

    // 3. Construct signature verification message
    const dataToVerify = Buffer.concat([authenticatorData, clientDataHash]);

    // 4. Verify signature using public key
    const publicKeyObject = crypto.createPublicKey({
      key: publicKeyBuffer,
      format: "der",
      type: "spki",
    });

    const verifier = crypto.createVerify("SHA256");
    verifier.update(dataToVerify);
    return verifier.verify(publicKeyObject, signature);
  } catch (err) {
    console.error("[WebAuthn] Signature verification error:", err);
    return false;
  }
}
