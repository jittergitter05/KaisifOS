/**
 * Creates an HMAC signed token using the ADMIN_USER and ADMIN_PASS.
 * Uses Web Crypto API to be compatible with Next.js Edge Runtime (middleware).
 */
export async function signToken(): Promise<string> {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'secret';
  
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
  
  // Convert ArrayBuffer to hex string
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies if the provided token matches the expected HMAC signature.
 * @param token The token string from the cookie
 */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  
  const expectedToken = await signToken();
  return token === expectedToken; // For Web Crypto in Edge, basic string comparison is usually acceptable since we don't have crypto.timingSafeEqual easily available.
}
