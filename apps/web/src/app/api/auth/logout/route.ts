import { NextResponse } from 'next/server';
import { destroySession } from '@/server/auth/session';
import { canonicalUrl } from '@/server/env';
import { route } from '@/server/http';

export const runtime = 'nodejs';

export const POST = route(async () => {
  await destroySession();
  return NextResponse.redirect(new URL('/', canonicalUrl()), { status: 303 });
});
