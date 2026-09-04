// PBKDF2-SHA256 hashovanie hesiel cez Web Crypto API (bez externych kniznic).
// Format: pbkdf2:<iteracie>:<hex-salt>:<hex-hash>

const ITERATIONS = 100_000;
const HASH_LENGTH = 32;

// Platny dummy hash pouzity na login ceste, ked email neexistuje. Vdaka nemu
// verifyPassword vzdy odbehne cely PBKDF2 vypocet a neexistujuci ucet netrva
// kratsie ako existujuci -> ziadna enumeracia emailov cez merania casu.
export const DUMMY_PASSWORD_HASH =
  `pbkdf2:${ITERATIONS}:${'0'.repeat(32)}:${'0'.repeat(64)}`;

export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial, HASH_LENGTH * 8
  );
  return `pbkdf2:${ITERATIONS}:${bufToHex(salt.buffer as ArrayBuffer)}:${bufToHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false;
  const iterations = parseInt(parts[1]);
  const salt = hexToBuf(parts[2]);
  const expected = parts[3];
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial, HASH_LENGTH * 8
  );
  return timingSafeEqual(bufToHex(hash), expected);
}

// SHA-256 hash IP adresy - do DB nikdy neukladame surovu IP (GDPR).
export async function hashIp(ip: string, secret: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + secret));
  return bufToHex(buf).slice(0, 32);
}
