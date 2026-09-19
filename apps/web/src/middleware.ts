import { NextResponse, type NextRequest } from 'next/server';

/**
 * Recipient session bootstrap.
 *
 * A Server Component cannot set a cookie, so the opaque recipient token is
 * minted here on the first request to a share link and handed to the page on
 * the same request through a header. The token is random and carries no
 * identity: the database row it keys is created by the page.
 */
const RECIPIENT_HEADER = 'x-companion-recipient';
const VIEWER_PATH = /^\/c\/([A-Za-z0-9]{4,24})(?:\/|$)/;

export function middleware(request: NextRequest): NextResponse {
  const match = VIEWER_PATH.exec(request.nextUrl.pathname);
  if (!match) return NextResponse.next();

  const slug = match[1] as string;
  const cookieName = `c_${slug}`;
  const existing = request.cookies.get(cookieName)?.value;

  if (existing) {
    // Forward the token so the page never has to re-read the cookie store.
    const headers = new Headers(request.headers);
    headers.set(RECIPIENT_HEADER, existing);
    return NextResponse.next({ request: { headers } });
  }

  const token = generateToken();
  const headers = new Headers(request.headers);
  headers.set(RECIPIENT_HEADER, token);

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}

/** 24 random bytes, base64url encoded. Web Crypto is available on the edge. */
function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const config = {
  matcher: ['/c/:slug*'],
};
