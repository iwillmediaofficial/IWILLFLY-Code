const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Makes a new web push key pair in this browser, so the private key never passes through chat or a
 * server. The public key goes into the VITE_VAPID_PUBLIC_KEY build variable, the private key (JSON)
 * into the VAPID_PRIVATE_JWK secret.
 */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateJwk: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const privateJwk = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
  return { publicKey, privateJwk };
}
