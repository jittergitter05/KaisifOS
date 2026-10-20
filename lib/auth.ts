export const DEFAULT_OPERATOR_USER = 'operator';
export const DEFAULT_OPERATOR_KEY = 'ksf-op-9x7v2q-local';

export function isCustomAuthConfigured(): boolean {
  return Boolean(
    process.env.ADMIN_USER &&
      process.env.ADMIN_USER.trim() !== '' &&
      process.env.ADMIN_PASS &&
      process.env.ADMIN_PASS.trim() !== ''
  );
}

/**
 * Creates an HMAC signed token using ADMIN_USER and ADMIN_PASS (or non-breached local fork key).
 * Uses Web Crypto API to be 100% compatible with Next.js Edge Runtime (middleware).
 */
export async function signToken(): Promise<string> {
  const adminUser = process.env.ADMIN_USER || DEFAULT_OPERATOR_USER;
  const adminPass = process.env.ADMIN_PASS || DEFAULT_OPERATOR_KEY;

  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(adminPass);
  const data = encoder.encode(adminUser);

  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies if the provided token matches the expected HMAC signature.
 */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expectedToken = await signToken();
  return token === expectedToken;
}

/**
 * Checks whether a request is authorized.
 * - If custom ADMIN_USER & ADMIN_PASS are set in environment variables, requires a valid HMAC cookie.
 * - If running in a fresh fork / local environment without custom .env credentials, allows direct
 *   operator access unless the user explicitly locked the session via Sign Out.
 */
export async function isAuthorizedRequest(
  authCookieValue: string | undefined,
  lockedCookieValue?: string | undefined
): Promise<boolean> {
  if (await verifyToken(authCookieValue)) {
    return true;
  }
  if (!isCustomAuthConfigured() && lockedCookieValue !== '1') {
    return true;
  }
  return false;
}
