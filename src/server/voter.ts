// The voter id behind POST /rate: made by the Worker after a Turnstile check and kept in a signed HttpOnly cookie,
// so a script can't make up ids to vote again. `${id}.${HMAC-SHA256(id)}`, base64url, keyed by VOTER_SECRET.

export const VOTER_COOKIE = 'lunch_voter';
const MAX_AGE = 365 * 24 * 60 * 60;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const encoder = new TextEncoder();

function key(secret: string, usage: 'sign' | 'verify'): ReturnType<typeof crypto.subtle.importKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

const toBase64Url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The cookie value for a new voter id. */
export async function signVoter(secret: string, id: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), encoder.encode(id));
  return `${id}.${toBase64Url(sig)}`;
}

/** The voter id from a Cookie header, or null when there is none or its signature doesn't match. */
export async function readVoter(secret: string, cookieHeader: string | null): Promise<string | null> {
  const value = cookieHeader
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VOTER_COOKIE}=`))
    ?.slice(VOTER_COOKIE.length + 1);
  const [id, sig, extra] = value?.split('.') ?? [];
  if (!id || !sig || extra !== undefined || !ID.test(id)) return null;
  const bytes = fromBase64Url(sig);
  if (!bytes) return null;
  // crypto.subtle.verify compares in constant time.
  return (await crypto.subtle.verify('HMAC', await key(secret, 'verify'), bytes, encoder.encode(id))) ? id : null;
}

/** Set-Cookie for a signed voter value: a year, this site only, not readable from scripts. */
export const voterCookie = (value: string): string =>
  `${VOTER_COOKIE}=${value}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`;
