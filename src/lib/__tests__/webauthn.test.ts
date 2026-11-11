/**
 * @file src/lib/__tests__/webauthn.test.ts
 * @description Comprehensive unit tests for WebAuthn Biometric Passkey cryptographic logic and verification.
 */

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  generateChallenge,
  parseClientData,
  resolveSpkiPublicKey,
  verifyAssertionSignature,
} from "@/lib/webauthn";
import {
  savePasskeyCredential,
  getPasskeyCredential,
  getUserPasskeys,
  deletePasskeyCredential,
  storeWebAuthnChallenge,
  getAndClearWebAuthnChallenge,
} from "@/lib/redis";
import { type StoredPasskeyCredential } from "@/types/webauthn";

describe("WebAuthn Biometric Authentication Suite", () => {
  describe("1. Challenge & ClientData Processing", () => {
    it("generates random base64url challenges with correct length", () => {
      const challenge1 = generateChallenge();
      const challenge2 = generateChallenge();
      expect(challenge1).not.toBe(challenge2);
      expect(typeof challenge1).toBe("string");
      expect(challenge1.length).toBeGreaterThanOrEqual(32);
    });

    it("parses clientDataJSON correctly and extracts type, challenge, and origin", () => {
      const clientDataObj = {
        type: "webauthn.get",
        challenge: "test-challenge-12345",
        origin: "https://gymflow.app",
        crossOrigin: false,
      };
      const clientDataJSONBase64 = Buffer.from(JSON.stringify(clientDataObj)).toString("base64url");

      const parsed = parseClientData(clientDataJSONBase64);
      expect(parsed.type).toBe("webauthn.get");
      expect(parsed.challenge).toBe("test-challenge-12345");
      expect(parsed.origin).toBe("https://gymflow.app");
    });
  });

  describe("2. Public Key Extraction & Resolution", () => {
    it("resolves valid SPKI public key when provided directly in base64", () => {
      const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const spkiDer = publicKey.export({ type: "spki", format: "der" });
      const spkiBase64 = spkiDer.toString("base64");

      const resolved = resolveSpkiPublicKey({ publicKeyBase64: spkiBase64 });
      expect(resolved.spkiBase64).toBe(spkiBase64);
      expect(resolved.algorithm).toBe(-7);
    });

    it("throws an error when neither publicKeyBase64 nor valid attestation is supplied", () => {
      expect(() => resolveSpkiPublicKey({})).toThrow();
    });
  });

  describe("3. Assertion Signature Verification", () => {
    it("successfully verifies a valid WebAuthn assertion signature", () => {
      // 1. Generate P-256 keypair simulating authenticator
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const spkiDer = publicKey.export({ type: "spki", format: "der" });
      const spkiBase64 = spkiDer.toString("base64");

      // 2. Simulate clientDataJSON
      const clientDataObj = {
        type: "webauthn.get",
        challenge: "sample-login-challenge",
        origin: "http://localhost:3000",
      };
      const clientDataJSON = Buffer.from(JSON.stringify(clientDataObj));
      const clientDataJSONBase64 = clientDataJSON.toString("base64url");

      // 3. Simulate authenticatorData (32 bytes rpIdHash + 1 byte flags + 4 bytes signCount)
      const rpIdHash = crypto.createHash("sha256").update("localhost").digest();
      const flags = Buffer.from([0x01 | 0x04]); // UP (User Present) + UV (User Verified)
      const signCount = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      const authenticatorData = Buffer.concat([rpIdHash, flags, signCount]);
      const authenticatorDataBase64 = authenticatorData.toString("base64url");

      // 4. Sign signedData = authenticatorData || SHA256(clientDataJSON)
      const clientDataHash = crypto.createHash("sha256").update(clientDataJSON).digest();
      const signedData = Buffer.concat([authenticatorData, clientDataHash]);

      const signer = crypto.createSign("SHA256");
      signer.update(signedData);
      const signature = signer.sign(privateKey);
      const signatureBase64 = signature.toString("base64url");

      // 5. Verify using our WebAuthn helper
      const isValid = verifyAssertionSignature({
        publicKeySpkiBase64: spkiBase64,
        authenticatorDataBase64,
        clientDataJSONBase64,
        signatureBase64,
      });

      expect(isValid).toBe(true);
    });

    it("rejects assertion when User Present (UP) flag is missing in authenticatorData", () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const spkiBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

      const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: "abc" }));
      const clientDataHash = crypto.createHash("sha256").update(clientDataJSON).digest();

      // Missing UP flag (flags = 0x00)
      const rpIdHash = crypto.createHash("sha256").update("localhost").digest();
      const flags = Buffer.from([0x00]);
      const signCount = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      const authenticatorData = Buffer.concat([rpIdHash, flags, signCount]);

      const signedData = Buffer.concat([authenticatorData, clientDataHash]);
      const signer = crypto.createSign("SHA256");
      signer.update(signedData);
      const signature = signer.sign(privateKey);

      const isValid = verifyAssertionSignature({
        publicKeySpkiBase64: spkiBase64,
        authenticatorDataBase64: authenticatorData.toString("base64url"),
        clientDataJSONBase64: clientDataJSON.toString("base64url"),
        signatureBase64: signature.toString("base64url"),
      });

      expect(isValid).toBe(false);
    });

    it("rejects assertion with mismatched signature or corrupted data", () => {
      const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const spkiBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

      const isValid = verifyAssertionSignature({
        publicKeySpkiBase64: spkiBase64,
        authenticatorDataBase64: Buffer.from([0x01]).toString("base64url"),
        clientDataJSONBase64: Buffer.from("invalid").toString("base64url"),
        signatureBase64: Buffer.from("corrupted-signature").toString("base64url"),
      });

      expect(isValid).toBe(false);
    });
  });

  describe("4. Passkey Persistence & Storage", () => {
    beforeEach(() => {
      // test clean slate
    });

    it("stores, retrieves, and deletes passkey credentials", async () => {
      const userId = "athlete-biometrics-user-1";
      const credential: StoredPasskeyCredential = {
        credentialId: "cred_test_123456",
        userId,
        publicKey: "MHYwEAYHKoZIzj0CAQYFK4EEACIDYgA...",
        publicKeyAlgorithm: -7,
        counter: 0,
        createdAt: new Date().toISOString(),
        deviceName: "MacBook Pro Touch ID",
      };

      await savePasskeyCredential(credential);

      const fetched = await getPasskeyCredential("cred_test_123456");
      expect(fetched).not.toBeNull();
      expect(fetched?.credentialId).toBe("cred_test_123456");
      expect(fetched?.userId).toBe(userId);
      expect(fetched?.deviceName).toBe("MacBook Pro Touch ID");

      const userPasskeys = await getUserPasskeys(userId);
      expect(userPasskeys).toHaveLength(1);
      expect(userPasskeys[0]?.credentialId).toBe("cred_test_123456");

      await deletePasskeyCredential(userId, "cred_test_123456");
      const afterDelete = await getPasskeyCredential("cred_test_123456");
      expect(afterDelete).toBeNull();

      const userPasskeysAfter = await getUserPasskeys(userId);
      expect(userPasskeysAfter).toHaveLength(0);
    });

    it("stores and single-use consumes WebAuthn challenge", async () => {
      const key = "test-challenge-key";
      const challenge = "random-challenge-xyz";

      await storeWebAuthnChallenge(key, challenge);

      const retrieved = await getAndClearWebAuthnChallenge(key);
      expect(retrieved).toBe(challenge);

      // Subsequent retrieval returns null (single use)
      const secondAttempt = await getAndClearWebAuthnChallenge(key);
      expect(secondAttempt).toBeNull();
    });
  });
});
