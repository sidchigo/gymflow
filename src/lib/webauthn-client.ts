/**
 * @file src/lib/webauthn-client.ts
 * @description Client-side browser helpers for WebAuthn Biometric registration and authentication.
 */

// ---------------------------------------------------------------------------
// Base64 & Buffer Conversion Helpers for Browser
// ---------------------------------------------------------------------------

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64UrlToBuffer(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Public Browser APIs
// ---------------------------------------------------------------------------

/**
 * Checks whether WebAuthn platform authenticators (Face ID, Touch ID, Windows Hello)
 * are supported on this device/browser.
 */
export async function isBiometricsSupported(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return false;
  }

  try {
    if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Triggers biometric passkey registration on the device for the currently logged-in athlete.
 */
export async function registerBiometrics(deviceName = "My Device Biometrics"): Promise<{ ok: boolean; message?: string }> {
  if (!window.PublicKeyCredential) {
    throw new Error("Biometric authentication is not supported on this browser.");
  }

  // 1. Get options from server
  const optRes = await fetch("/api/auth/webauthn/register/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!optRes.ok) {
    const errData = (await optRes.json()) as { error?: string };
    throw new Error(errData.error || "Failed to initialize biometric registration.");
  }

  interface ServerRegOptions {
    challenge: string;
    rp: { name: string; id?: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
    timeout: number;
    authenticatorSelection?: AuthenticatorSelectionCriteria;
  }

  const serverOptions = (await optRes.json()) as ServerRegOptions;

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64UrlToBuffer(serverOptions.challenge).buffer as ArrayBuffer,
    rp: serverOptions.rp,
    user: {
      id: base64UrlToBuffer(serverOptions.user.id).buffer as ArrayBuffer,
      name: serverOptions.user.name,
      displayName: serverOptions.user.displayName,
    },
    pubKeyCredParams: serverOptions.pubKeyCredParams,
    timeout: serverOptions.timeout,
  };

  if (serverOptions.authenticatorSelection) {
    publicKey.authenticatorSelection = serverOptions.authenticatorSelection;
  }

  const creationOptions: CredentialCreationOptions = {
    publicKey,
  };

  // 2. Invoke browser authenticator
  const credential = (await navigator.credentials.create(creationOptions)) as PublicKeyCredential | null;
  if (!credential) {
    throw new Error("Biometric registration was cancelled or not completed.");
  }

  const response = credential.response as AuthenticatorAttestationResponse;

  // Extract public key if getPublicKey() is supported
  let publicKeyBase64: string | undefined;
  let publicKeyAlgorithm: number | undefined;

  if (typeof (response as any).getPublicKey === "function") {
    try {
      const pkBuf = (response as any).getPublicKey() as ArrayBuffer | null;
      if (pkBuf) {
        publicKeyBase64 = bufferToBase64(pkBuf);
      }
    } catch {
      // Ignore
    }
  }

  if (typeof (response as any).getPublicKeyAlgorithm === "function") {
    try {
      publicKeyAlgorithm = (response as any).getPublicKeyAlgorithm();
    } catch {
      // Ignore
    }
  }

  // 3. Send back to server for verification
  const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: "public-key",
      response: {
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        attestationObject: bufferToBase64Url(response.attestationObject),
        publicKey: publicKeyBase64,
        publicKeyAlgorithm,
      },
      deviceName,
    }),
  });

  if (!verifyRes.ok) {
    const errData = (await verifyRes.json()) as { error?: string };
    throw new Error(errData.error || "Failed to verify biometric registration.");
  }

  if (typeof window !== "undefined") {
    localStorage.setItem("gymflow_biometrics_enrolled", "true");
  }

  return { ok: true, message: "Biometrics successfully registered." };
}

/**
 * Performs 1-click biometric sign-in using Face ID, Touch ID, or Windows Hello.
 */
export async function authenticateWithBiometrics(): Promise<{ ok: boolean; userId: string }> {
  if (!window.PublicKeyCredential) {
    throw new Error("Biometric authentication is not supported on this browser.");
  }

  // 1. Get login assertion options from server
  const optRes = await fetch("/api/auth/webauthn/login/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!optRes.ok) {
    const errData = (await optRes.json()) as { error?: string };
    throw new Error(errData.error || "Failed to initialize biometric login.");
  }

  interface ServerLoginOptions {
    challenge: string;
    timeout: number;
    rpId?: string;
    userVerification?: UserVerificationRequirement;
  }

  const serverOptions = (await optRes.json()) as ServerLoginOptions;

  const requestOptions: CredentialRequestOptions = {
    publicKey: {
      challenge: base64UrlToBuffer(serverOptions.challenge).buffer as ArrayBuffer,
      timeout: serverOptions.timeout,
      rpId: serverOptions.rpId || window.location.hostname,
      userVerification: serverOptions.userVerification || "preferred",
    },
  };

  // 2. Invoke browser authenticator
  const assertion = (await navigator.credentials.get(requestOptions)) as PublicKeyCredential | null;
  if (!assertion) {
    throw new Error("Biometric login was cancelled.");
  }

  const response = assertion.response as AuthenticatorAssertionResponse;

  // 3. Send assertion to server
  const verifyRes = await fetch("/api/auth/webauthn/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: assertion.id,
      rawId: bufferToBase64Url(assertion.rawId),
      type: "public-key",
      response: {
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        authenticatorData: bufferToBase64Url(response.authenticatorData),
        signature: bufferToBase64Url(response.signature),
        userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : undefined,
      },
    }),
  });

  if (!verifyRes.ok) {
    const errData = (await verifyRes.json()) as { error?: string };
    throw new Error(errData.error || "Biometric verification failed.");
  }

  const result = (await verifyRes.json()) as { ok: boolean; userId: string };
  return result;
}
