import { NextResponse } from 'next/server';
import { destroySession } from '@/server/auth/session';
import { appUrl } from '@/server/env';
import { route } from '@/server/http';

export const runtime = 'nodejs';

export const POST = route(async () => {
  await destroySession();
  return NextResponse.redirect(new URL('/', appUrl()), { status: 303 });
});
