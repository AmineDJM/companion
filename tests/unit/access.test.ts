import { describe, expect, it } from 'vitest';
import {
  derivedStatus,
  evaluateAskAccess,
  evaluateCompanionAvailability,
  evaluateDownloadAccess,
  evaluateRecipientAccess,
  expiresSoon,
  isEmailAllowed,
  isExpired,
  resolveExpiration,
  type CompanionAccessState,
  type RecipientCredentials,
} from '@companion/shared';

const NOW = new Date('2026-06-15T12:00:00Z');

function state(overrides: Partial<CompanionAccessState> = {}): CompanionAccessState {
  return {
    status: 'ACTIVE',
    accessMode: 'PUBLIC',
    expiresAt: null,
    revokedAt: null,
    pausedAt: null,
    downloadAllowed: false,
    aiEnabled: true,
    workspaceSuspended: false,
    allowedEmails: [],
    allowedDomains: [],
    ...overrides,
  };
}

const ANON: RecipientCredentials = { passwordVerified: false, verifiedEmail: null };

describe('companion availability', () => {
  it('serves an active companion', () => {
    expect(evaluateCompanionAvailability(state(), NOW).allowed).toBe(true);
  });

  it('refuses a revoked companion even before the status catches up', () => {
    const decision = evaluateCompanionAvailability(
      state({ revokedAt: new Date('2026-06-14T00:00:00Z') }),
      NOW,
    );
    expect(decision).toEqual({
      allowed: false,
      code: 'companion_revoked',
      message: 'This document is no longer available.',
    });
  });

  it('refuses an expired companion derived from the clock alone', () => {
    const decision = evaluateCompanionAvailability(
      state({ expiresAt: new Date('2026-06-15T11:59:59Z') }),
      NOW,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('companion_expired');
  });

  it('treats an expiry exactly at now as expired', () => {
    expect(isExpired(new Date(NOW), NOW)).toBe(true);
  });

  it('refuses a paused companion with a distinct, temporary message', () => {
    const decision = evaluateCompanionAvailability(state({ pausedAt: NOW }), NOW);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe('companion_paused');
      expect(decision.message).toContain('temporarily');
    }
  });

  it('refuses everything for a suspended workspace', () => {
    const decision = evaluateCompanionAvailability(state({ workspaceSuspended: true }), NOW);
    expect(decision.allowed).toBe(false);
  });

  it('does not serve a companion that is still being prepared', () => {
    const decision = evaluateCompanionAvailability(state({ status: 'PROCESSING' }), NOW);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('companion_not_ready');
  });

  it('makes a revoked and an archived companion indistinguishable to a recipient', () => {
    const revoked = evaluateCompanionAvailability(state({ status: 'REVOKED' }), NOW);
    const archived = evaluateCompanionAvailability(state({ status: 'ARCHIVED' }), NOW);
    expect(revoked).toEqual(archived);
  });
});

describe('recipient access', () => {
  it('lets anyone open a public companion', () => {
    expect(evaluateRecipientAccess(state(), ANON, NOW).allowed).toBe(true);
  });

  it('requires the password before serving a protected companion', () => {
    const decision = evaluateRecipientAccess(state({ accessMode: 'PASSWORD' }), ANON, NOW);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('password_required');
  });

  it('serves a protected companion once the password is proven', () => {
    const decision = evaluateRecipientAccess(
      state({ accessMode: 'PASSWORD' }),
      { passwordVerified: true, verifiedEmail: null },
      NOW,
    );
    expect(decision.allowed).toBe(true);
  });

  it('never lets a proven password bypass revocation', () => {
    const decision = evaluateRecipientAccess(
      state({ accessMode: 'PASSWORD', revokedAt: NOW }),
      { passwordVerified: true, verifiedEmail: null },
      NOW,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('companion_revoked');
  });

  it('requires identity for an email-gated companion', () => {
    const decision = evaluateRecipientAccess(
      state({ accessMode: 'EMAIL_LIST', allowedEmails: ['anna@acme.com'] }),
      ANON,
      NOW,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('identity_required');
  });

  it('admits an address on the list and refuses one that is not', () => {
    const gated = state({ accessMode: 'EMAIL_LIST', allowedEmails: ['anna@acme.com'] });
    expect(
      evaluateRecipientAccess(gated, { passwordVerified: false, verifiedEmail: 'anna@acme.com' }, NOW)
        .allowed,
    ).toBe(true);
    expect(
      evaluateRecipientAccess(gated, { passwordVerified: false, verifiedEmail: 'eve@evil.com' }, NOW)
        .allowed,
    ).toBe(false);
  });

  it('admits a whole allowed domain', () => {
    const gated = state({ accessMode: 'EMAIL_LIST', allowedDomains: ['acme.com'] });
    expect(
      evaluateRecipientAccess(gated, { passwordVerified: false, verifiedEmail: 'NEW@Acme.COM' }, NOW)
        .allowed,
    ).toBe(true);
  });
});

describe('email matching', () => {
  it('is case and whitespace insensitive', () => {
    expect(isEmailAllowed('  Anna@Acme.com ', ['anna@acme.com'], [])).toBe(true);
  });

  it('does not treat a subdomain as the allowed domain', () => {
    expect(isEmailAllowed('eve@evil.acme.com', [], ['acme.com'])).toBe(false);
  });

  it('matches on the final @ so a display name cannot smuggle a domain', () => {
    expect(isEmailAllowed('acme.com@evil.com', [], ['acme.com'])).toBe(false);
  });
});

describe('download and ask gates', () => {
  it('refuses download while downloads are disabled', () => {
    const decision = evaluateDownloadAccess(state({ downloadAllowed: false }), ANON, NOW);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('download_disabled');
  });

  it('allows download once the sender enables it', () => {
    expect(evaluateDownloadAccess(state({ downloadAllowed: true }), ANON, NOW).allowed).toBe(true);
  });

  it('refuses download on an expired companion even when downloads are on', () => {
    const decision = evaluateDownloadAccess(
      state({ downloadAllowed: true, expiresAt: new Date('2026-01-01T00:00:00Z') }),
      ANON,
      NOW,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('companion_expired');
  });

  it('refuses questions when the sender turned them off', () => {
    const decision = evaluateAskAccess(state({ aiEnabled: false }), ANON, NOW);
    expect(decision.allowed).toBe(false);
  });
});

describe('expiration', () => {
  it('resolves each preset relative to now', () => {
    expect(resolveExpiration('never', null, NOW)).toBeNull();
    expect(resolveExpiration('24h', null, NOW)?.toISOString()).toBe('2026-06-16T12:00:00.000Z');
    expect(resolveExpiration('7d', null, NOW)?.toISOString()).toBe('2026-06-22T12:00:00.000Z');
    expect(resolveExpiration('30d', null, NOW)?.toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('uses the custom date when one is supplied', () => {
    const custom = new Date('2026-12-25T00:00:00Z');
    expect(resolveExpiration('custom', custom, NOW)).toEqual(custom);
  });

  it('flags an expiry inside the nudge window and not outside it', () => {
    expect(expiresSoon(new Date('2026-06-17T00:00:00Z'), NOW)).toBe(true);
    expect(expiresSoon(new Date('2026-06-30T00:00:00Z'), NOW)).toBe(false);
    expect(expiresSoon(new Date('2026-06-01T00:00:00Z'), NOW)).toBe(false);
    expect(expiresSoon(null, NOW)).toBe(false);
  });

  it('derives expiry from the clock, so extending revives the same link', () => {
    expect(derivedStatus('ACTIVE', new Date('2026-01-01T00:00:00Z'), NOW)).toBe('EXPIRED');
    expect(derivedStatus('EXPIRED', new Date('2026-12-01T00:00:00Z'), NOW)).toBe('ACTIVE');
    expect(derivedStatus('REVOKED', null, NOW)).toBe('REVOKED');
  });
});
