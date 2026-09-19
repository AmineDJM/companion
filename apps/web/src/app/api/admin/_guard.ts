import type { AuthContext } from '@/server/auth/session';
import { requireSuperAdmin } from '@/server/auth/session';

/**
 * Every admin route calls this first. Authorisation is server-side and
 * unconditional; a non-admin receives a not-found so the console's existence is
 * not disclosed.
 */
export async function adminContext(): Promise<{
  auth: AuthContext;
  adminUserId: string;
  adminLabel: string;
}> {
  const auth = await requireSuperAdmin();
  return {
    auth,
    adminUserId: auth.user.id,
    adminLabel: auth.user.email,
  };
}
