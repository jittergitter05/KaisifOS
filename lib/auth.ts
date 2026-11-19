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
 * Returns true when an operator configured only one of ADMIN_USER or ADMIN_PASS.
 * In this misconfigured state, authentication MUST fail closed instead of falling back to open mode.
 */
export function hasPartialAuthConfig(): boolean {
  const hasUser = Boolean(process.env.ADMIN_USER && process.env.ADMIN_USER.trim() !== '');
  const hasPass = Boolean(process.env.ADMIN_PASS && process.env.ADMIN_PASS.trim() !== '');
  return hasUser !== hasPass;
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks on HMAC tokens
 * and credential verification in Edge and Node runtimes.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
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
 * Verifies if the provided token matches the expected HMAC signature using constant-time comparison.
 */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token || hasPartialAuthConfig()) return false;
  const expectedToken = await signToken();
  return constantTimeEqual(token, expectedToken);
}

/**
 * Checks whether a request is authorized.
 * - If only one of ADMIN_USER or ADMIN_PASS is set, fails CLOSED for security.
 * - If custom ADMIN_USER & ADMIN_PASS are set in environment variables, requires a valid HMAC cookie.
 * - If running in a fresh fork / local environment without custom .env credentials, allows direct
 *   operator access unless the user explicitly locked the session via Sign Out.
 */
export async function isAuthorizedRequest(
  authCookieValue: string | undefined,
  lockedCookieValue?: string | undefined
): Promise<boolean> {
  if (hasPartialAuthConfig()) {
    return false;
  }
  if (await verifyToken(authCookieValue)) {
    return true;
  }
  if (!isCustomAuthConfigured() && lockedCookieValue !== '1') {
    return true;
  }
  return false;
}

/**
 * Verifies that a cookie-authenticated mutating browser request originates from the same host.
 * Supports reverse proxies (Cloud Run / nginx / Vercel) via X-Forwarded-Host as well as Host,
 * protecting mutating endpoints even when cookies use SameSite=None inside embedded HTTPS iframes.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const secFetchSite = (headers.get('sec-fetch-site') || '').trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const allowedHosts = new Set<string>();
  const rawHost = (headers.get('host') || '').trim().toLowerCase();
  if (rawHost) allowedHosts.add(rawHost);

  const rawForwardedHost = (headers.get('x-forwarded-host') || '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (rawForwardedHost) allowedHosts.add(rawForwardedHost);

  const origin = headers.get('origin');
  if (origin && origin !== 'null') {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      return allowedHosts.size > 0 && allowedHosts.has(originHost);
    } catch {
      return false;
    }
  }
  if (origin === 'null') {
    return false;
  }

  const referer = headers.get('referer');
  if (referer) {
    try {
      const refererHost = new URL(referer).host.toLowerCase();
      return allowedHosts.size > 0 && allowedHosts.has(refererHost);
    } catch {
      return false;
    }
  }

  return secFetchSite === 'same-origin' || secFetchSite === 'none' || !secFetchSite;
}

/**
 * Resolves secure & SameSite cookie attributes based on actual request transport & iframe context.
 * Prevents login loops on local `next start` (http://localhost) AND embedded HTTPS iframes (Cloud Run).
 */
export function getCookieSecurityOptions(headers: Headers, requestUrl?: string) {
  const forwardedProto = (headers.get('x-forwarded-proto') || '').split(',')[0]?.trim().toLowerCase();
  const isHttps =
    forwardedProto === 'https' ||
    (typeof requestUrl === 'string' && requestUrl.startsWith('https://'));
  const secFetchDest = (headers.get('sec-fetch-dest') || '').toLowerCase();
  const isEmbeddedIframe = secFetchDest === 'iframe';

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: (isHttps && isEmbeddedIframe ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
  };
}
