import { describe, it, expect } from "vitest";
import { generateVAPIDKeys, generateRequestDetails } from "web-push-neo";

/**
 * These tests stand in for a browser: we generate a real subscription keypair,
 * let the library encrypt to it, then decrypt the result with an independent
 * RFC 8291 implementation written here.
 *
 * The point is to prove the wire format is correct *before* trusting it on a
 * phone. A push that is encrypted wrongly is accepted by the push service and
 * then silently discarded by the browser -- there is no error to observe. This
 * is the only cheap place to catch that.
 */

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data as BufferSource));
}

/** A fake browser push subscription, with the private key retained so we can decrypt. */
async function createFakeSubscription() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;

  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));

  const b64url = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return {
    privateKey: pair.privateKey,
    publicRaw,
    authSecret,
    subscription: {
      endpoint: "https://web.push.apple.com/fake-endpoint-for-tests",
      keys: { p256dh: b64url(publicRaw), auth: b64url(authSecret) },
    },
  };
}

/** Independent RFC 8291 receiver-side decryption. */
async function decryptPush(
  body: Uint8Array,
  uaPrivate: CryptoKey,
  uaPublicRaw: Uint8Array,
  authSecret: Uint8Array,
): Promise<string> {
  // Body layout: salt(16) | record size(4) | key id length(1) | key id | ciphertext
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const serverPublicRaw = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);

  expect(idLength).toBe(65); // uncompressed P-256 point

  const serverPublic = await crypto.subtle.importKey(
    "raw",
    serverPublicRaw as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: serverPublic }, uaPrivate, 256),
  );

  // PRK_key = HMAC(auth_secret, ecdh_secret); IKM = HKDF-Expand with the
  // WebPush key info, which binds both public keys into the derivation.
  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const keyInfo = concat(
    encoder.encode("WebPush: info\0"),
    uaPublicRaw,
    serverPublicRaw,
    new Uint8Array([1]),
  );
  const ikm = await hmacSha256(prkKey, keyInfo);
  const prk = await hmacSha256(salt, ikm);

  const cek = (
    await hmacSha256(prk, concat(encoder.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))
  ).slice(0, 16);
  const nonce = (
    await hmacSha256(prk, concat(encoder.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))
  ).slice(0, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, [
    "decrypt",
  ]);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aesKey,
      ciphertext as BufferSource,
    ),
  );

  // Strip the padding delimiter: trailing zeros, then 0x02 marking the last record.
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  expect(padded[end - 1]).toBe(0x02);

  return new TextDecoder().decode(padded.slice(0, end - 1));
}

describe("web push wire format", () => {
  it("produces a body our independent RFC 8291 decryption can read back", async () => {
    const vapid = await generateVAPIDKeys();
    const ua = await createFakeSubscription();
    const payload = JSON.stringify({ title: "5 items to restock", body: "Rice, Milk, Eggs" });

    const details = await generateRequestDetails(ua.subscription, payload, {
      vapidDetails: {
        subject: "mailto:mahmudulhk13@gmail.com",
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    });

    expect(details.body).not.toBeNull();
    const decrypted = await decryptPush(details.body!, ua.privateKey, ua.publicRaw, ua.authSecret);

    expect(decrypted).toBe(payload);
  });

  it("uses the modern aes128gcm encoding Apple requires, not the legacy aesgcm draft", async () => {
    const vapid = await generateVAPIDKeys();
    const ua = await createFakeSubscription();

    const details = await generateRequestDetails(ua.subscription, "hello", {
      vapidDetails: {
        subject: "mailto:mahmudulhk13@gmail.com",
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    });

    const headers = new Headers(details.headers as HeadersInit);
    expect(headers.get("Content-Encoding")).toBe("aes128gcm");
    // Legacy-scheme headers must be absent -- their presence would mean the
    // aesgcm draft, which Safari/iOS never implemented.
    expect(headers.get("Crypto-Key")).toBeNull();
    expect(headers.get("Encryption")).toBeNull();
  });

  it("signs an RFC 8292 VAPID header rather than the draft-01 'WebPush' scheme", async () => {
    const vapid = await generateVAPIDKeys();
    const ua = await createFakeSubscription();

    const details = await generateRequestDetails(ua.subscription, "hello", {
      vapidDetails: {
        subject: "mailto:mahmudulhk13@gmail.com",
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    });

    const auth = new Headers(details.headers as HeadersInit).get("Authorization") ?? "";
    // RFC 8292 makes the whitespace after the comma optional; this library omits it.
    expect(auth).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+,\s?k=[\w-]+$/);

    // The JWT audience must be the push service origin, or Apple rejects it.
    const jwt = auth.slice("vapid t=".length).split(",")[0]!;
    const claims = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(jwt.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
          (ch) => ch.charCodeAt(0),
        ),
      ),
    );
    expect(claims.aud).toBe("https://web.push.apple.com");
    expect(claims.sub).toBe("mailto:mahmudulhk13@gmail.com");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("encrypts differently every time, so payloads are not replayable", async () => {
    const vapid = await generateVAPIDKeys();
    const ua = await createFakeSubscription();
    const opts = {
      vapidDetails: {
        subject: "mailto:mahmudulhk13@gmail.com",
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    };

    const a = await generateRequestDetails(ua.subscription, "same text", opts);
    const b = await generateRequestDetails(ua.subscription, "same text", opts);

    expect(a.body).not.toEqual(b.body);
  });
});
