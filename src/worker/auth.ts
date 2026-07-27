// Passcode hashing and session tokens.
//
// There are no user accounts: one household shares a passcode, and each device
// then picks which member is holding it. The session cookie therefore carries
// both the household and the chosen member.
//
// Everything here uses Web Crypto only -- Node's crypto is not available in a
// Worker, and the `web-push`-style npm packages that assume it will not run.

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 guidance for PBKDF2-SHA256
const SESSION_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year: this is a home appliance
export const SESSION_COOKIE = "pantry_session";

const encoder = new TextEncoder();

/* -------------------------------------------------------------------------- */
/* base64url                                                                   */
/* -------------------------------------------------------------------------- */

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)!;
  return bytes;
}

/**
 * Compare two strings without leaking their contents through timing.
 * Length is compared first because it is not secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* Passcode hashing                                                            */
/* -------------------------------------------------------------------------- */

async function pbkdf2(passcode: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(passcode), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Produces `pbkdf2$<iterations>$<salt_b64url>$<hash_b64url>`. */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(passcode, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;

  const hash = await pbkdf2(passcode, b64urlDecode(parts[2]!), iterations);
  return timingSafeEqual(b64urlEncode(hash), parts[3]!);
}

/* -------------------------------------------------------------------------- */
/* Session tokens                                                              */
/* -------------------------------------------------------------------------- */

export interface SessionPayload {
  householdId: string;
  /** null between entering the passcode and picking a profile. */
  memberId: string | null;
  /** Expiry, unix seconds. */
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs a session payload as `<payload_b64url>.<hmac_b64url>`. */
export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Returns the payload, or null if the token is malformed, forged, or expired. */
export async function verifySession(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      b64urlDecode(signature) as BufferSource,
      encoder.encode(body),
    );
  } catch {
    return null; // signature wasn't valid base64url
  }
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }

  if (typeof payload?.householdId !== "string" || typeof payload?.exp !== "number") return null;
  if (payload.exp <= now) return null;

  return payload;
}

export function sessionExpiry(now: number = Math.floor(Date.now() / 1000)): number {
  return now + SESSION_TTL_SECONDS;
}

export function buildSessionCookie(token: string, secure: boolean): string {
  // SameSite=Lax keeps the cookie on normal navigation (including the PWA being
  // opened from the Home Screen) while blocking cross-site form posts.
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function readSessionCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}
