// Keys and the Viso (whoiam) delegation proof, with no storage or network so tests can use them as they are.
// Format checked against freenames: delegation/src/lib.rs (connect_message) and ui/src/whoiam.ts.
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
export const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
export const unhex = h => Uint8Array.from(h.match(/../g) ?? [], b => parseInt(b, 16));
const PKCS8 = '302e020100300506032b657004220420'; // wraps a raw 32-byte Ed25519 secret

export const newSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const isSecret = s => /^[0-9a-f]{64}$/.test(s);
export const sha256 = async (...parts) => new Uint8Array(await subtle.digest('SHA-256', new Uint8Array(parts.flatMap(p => [...p]))));

export async function keysOf(secret) {
  const priv = await subtle.importKey('pkcs8', unhex(PKCS8 + secret), 'Ed25519', true, ['sign']);
  const { x } = await subtle.exportKey('jwk', priv);
  const pk = hex(Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
  return { pk, sign: async m => hex(new Uint8Array(await subtle.sign('Ed25519', priv, enc.encode(m)))) };
}

/** First 8 bytes of sha256(app path): what a class binds delegations to (app_tag in the contract). */
export const appTag = async path => hex((await sha256(enc.encode(path))).slice(0, 8));

/** What Viso signs: "whoiam-connect-v1" || pk || u32le len || base || u32le len || challenge || u64le ts. */
export function connectMessage(pk, base, challenge, ts) {
  const parts = [enc.encode('whoiam-connect-v1'), pk];
  for (const f of [base, challenge]) { const b = enc.encode(f); parts.push(new Uint8Array(new Uint32Array([b.length]).buffer), b); }
  parts.push(new Uint8Array(new BigUint64Array([BigInt(ts)]).buffer));
  return Uint8Array.from(parts.flatMap(p => [...p]));
}

/** Does the persona's signature hold? (Whether it is the sign-in we asked for is checked by the caller.) */
export async function verifyProof({ pk, sig, ts, challenge, base }) {
  try {
    const key = await subtle.importKey('raw', unhex(pk), 'Ed25519', false, ['verify']);
    return await subtle.verify('Ed25519', key, unhex(sig), connectMessage(unhex(pk), base, challenge, ts));
  } catch { return false; }
}
