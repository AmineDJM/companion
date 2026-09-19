'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { formatDateLong, type AccessMode, type SourceProtectionMode } from '@companion/shared';
import { clsx } from 'clsx';
import { ApiError, apiFetch } from '../../lib/api';
import { Button } from '../ui/button';
import { SegmentedControl, TextArea, TextInput, Toggle } from '../ui/fields';
import { Badge, Card, SectionHeading } from '../ui/primitives';
import { CheckIcon, LockIcon } from '../ui/icons';

type Preset = 'never' | '24h' | '7d' | '30d' | 'custom';

export interface AccessState {
  accessMode: AccessMode;
  hasPassword: boolean;
  allowedEmails: string[];
  allowedDomains: string[];
  expiresAt: string | null;
  downloadAllowed: boolean;
  aiEnabled: boolean;
  sourceProtectionMode: SourceProtectionMode;
  showCompanionBranding: boolean;
  senderLabel: string | null;
}

export interface AccessEntitlements {
  passwordProtection: boolean;
  emailListAccess: boolean;
  identifiedAccess: boolean;
  customExpiration: boolean;
  removeBranding: boolean;
  /**
   * Whether this instance can send a message at all. Sharing a link never
   * needs it — you copy the link and send it yourself — but the two modes
   * that confirm a recipient's address do.
   */
  emailDelivery: boolean;
}

const EMAIL_REQUIRED =
  'Needs email, which is not set up here. This instance can still share public and password-protected links.';

/**
 * Access controls.
 *
 * Every change here applies to the link that has already been sent. Nothing on
 * this page can ever change the URL.
 */
export function AccessControls({
  companionId,
  slug,
  initial,
  entitlements,
}: {
  companionId: string;
  slug: string;
  initial: AccessState;
  entitlements: AccessEntitlements;
}) {
  const router = useRouter();
  const [accessMode, setAccessMode] = useState<AccessMode>(initial.accessMode);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [emails, setEmails] = useState(initial.allowedEmails.join('\n'));
  const [domains, setDomains] = useState(initial.allowedDomains.join('\n'));
  const [preset, setPreset] = useState<Preset>(initial.expiresAt ? 'custom' : 'never');
  const [customDate, setCustomDate] = useState(
    initial.expiresAt ? initial.expiresAt.slice(0, 10) : '',
  );
  const [downloadAllowed, setDownloadAllowed] = useState(initial.downloadAllowed);
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled);
  const [protection, setProtection] = useState<SourceProtectionMode>(initial.sourceProtectionMode);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/api/companions/${companionId}/access`, {
        method: 'PATCH',
        json: {
          accessMode,
          ...(clearPassword
            ? { password: null }
            : password
              ? { password }
              : {}),
          allowedEmails: emails
            .split(/[\n,;]+/)
            .map((value) => value.trim())
            .filter(Boolean),
          allowedDomains: domains
            .split(/[\n,;]+/)
            .map((value) => value.trim().replace(/^@/, ''))
            .filter(Boolean),
          expirationPreset: preset,
          ...(preset === 'custom' && customDate
            ? { expiresAt: new Date(`${customDate}T23:59:59Z`).toISOString() }
            : {}),
          downloadAllowed,
          aiEnabled,
          sourceProtectionMode: protection,
        },
      });
      setPassword('');
      setClearPassword(false);
      setSaved(true);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : 'Could not save these changes.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading
          title="Who can open this link"
          description="Changes apply immediately to the link you already sent."
        />
        <div className="mt-5 space-y-2">
          <ModeOption
            checked={accessMode === 'PUBLIC'}
            onSelect={() => setAccessMode('PUBLIC')}
            title="Anyone with the link"
            description="No password, no email. The simplest way to share."
          />
          <ModeOption
            checked={accessMode === 'PASSWORD'}
            onSelect={() => setAccessMode('PASSWORD')}
            title="Password protected"
            description="Recipients enter a password you choose."
            locked={!entitlements.passwordProtection}
          />
          <ModeOption
            checked={accessMode === 'EMAIL_LIST'}
            onSelect={() => setAccessMode('EMAIL_LIST')}
            title="Specific people"
            description="Only the addresses or domains you list can open it."
            locked={!entitlements.emailListAccess || !entitlements.emailDelivery}
            {...(entitlements.emailListAccess && !entitlements.emailDelivery
              ? { lockedReason: EMAIL_REQUIRED }
              : {})}
          />
          <ModeOption
            checked={accessMode === 'IDENTIFIED'}
            onSelect={() => setAccessMode('IDENTIFIED')}
            title="Identified access"
            description="Anyone with the link, but they confirm an email address first."
            locked={!entitlements.identifiedAccess || !entitlements.emailDelivery}
            {...(entitlements.identifiedAccess && !entitlements.emailDelivery
              ? { lockedReason: EMAIL_REQUIRED }
              : {})}
          />
        </div>

        {accessMode === 'PASSWORD' ? (
          <div className="mt-5 space-y-3 rounded-[14px] bg-canvas p-4">
            <TextInput
              type="password"
              label={initial.hasPassword ? 'Change password' : 'Set a password'}
              placeholder={initial.hasPassword ? 'Leave blank to keep the current one' : ''}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setClearPassword(false);
              }}
              hint="Share it separately from the link."
            />
            {initial.hasPassword ? (
              <label className="flex items-center gap-2 text-[13px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={(event) => setClearPassword(event.target.checked)}
                  className="size-4 rounded border-line accent-[color:var(--color-accent)]"
                />
                Remove the password
              </label>
            ) : null}
          </div>
        ) : null}

        {accessMode === 'EMAIL_LIST' ? (
          <div className="mt-5 grid gap-4 rounded-[14px] bg-canvas p-4 sm:grid-cols-2">
            <TextArea
              label="Email addresses"
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              placeholder="anna@acme.com&#10;paul@acme.com"
              hint="One per line."
            />
            <TextArea
              label="Or whole domains"
              value={domains}
              onChange={(event) => setDomains(event.target.value)}
              placeholder="acme.com"
              hint="Anyone with an address at these domains."
            />
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeading title="Expiration" description="You can always extend this later." />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SegmentedControl
            ariaLabel="Expiration"
            value={preset}
            onChange={(next) => setPreset(next)}
            options={[
              { value: 'never', label: 'Never' },
              { value: '24h', label: '24 hours' },
              { value: '7d', label: '7 days' },
              { value: '30d', label: '30 days' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          {preset === 'custom' ? (
            <input
              type="date"
              value={customDate}
              onChange={(event) => setCustomDate(event.target.value)}
              aria-label="Expiration date"
              disabled={!entitlements.customExpiration}
              className="h-9 rounded-[11px] border border-line bg-surface px-3 text-[13.5px] text-ink focus:border-accent focus:outline-none disabled:opacity-50"
            />
          ) : null}
        </div>
        {initial.expiresAt ? (
          <p className="mt-3 text-[12.5px] text-ink-muted">
            Currently expires {formatDateLong(initial.expiresAt)}.
          </p>
        ) : null}
        {!entitlements.customExpiration && preset === 'custom' ? (
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Custom dates are available on paid plans.{' '}
            <Link href="/pricing" className="text-accent hover:text-accent-hover">
              See plans
            </Link>
          </p>
        ) : null}
      </Card>

      <Card>
        <SectionHeading title="What recipients can do" />
        <div className="mt-5 space-y-5">
          <Toggle
            checked={downloadAllowed}
            onChange={setDownloadAllowed}
            label="Allow downloads"
            description={
              downloadAllowed
                ? 'Recipients can download the original files.'
                : 'Recipients can read and ask questions. The original file is never sent to their browser — though no web viewer can prevent a screenshot.'
            }
          />
          <Toggle
            checked={aiEnabled}
            onChange={setAiEnabled}
            label="Allow questions"
            description="Recipients can ask about the shared material and get cited answers."
          />
          <div>
            <p className="text-[14px] font-[500] text-ink">Source protection</p>
            <p className="mt-0.5 mb-3 text-[12.5px] leading-relaxed text-ink-muted">
              How strictly Companion refuses attempts to reproduce your documents through questions.
            </p>
            <SegmentedControl
              ariaLabel="Source protection"
              value={protection}
              onChange={(next) => setProtection(next)}
              options={[
                { value: 'OFF', label: 'Off' },
                { value: 'STANDARD', label: 'Standard' },
                { value: 'STRICT', label: 'Strict' },
              ]}
            />
          </div>
        </div>
      </Card>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-[16px] border border-line bg-surface/95 px-4 py-3 shadow-[0_6px_24px_rgba(21,22,26,0.08)] backdrop-blur">
        <p className="text-[12.5px] text-ink-muted">
          The link stays <span className="font-mono text-ink">/c/{slug}</span> whatever you change.
        </p>
        <div className="flex items-center gap-3">
          {saved ? (
            <span className="flex items-center gap-1.5 text-[13px] text-success">
              <CheckIcon size={15} /> Saved
            </span>
          ) : null}
          {error ? (
            <span role="alert" className="text-[13px] text-danger">
              {error}
            </span>
          ) : null}
          <Button onClick={save} loading={busy}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModeOption({
  checked,
  onSelect,
  title,
  description,
  locked,
  lockedReason,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  locked?: boolean;
  /** Shown in place of the description when the option is unavailable. */
  lockedReason?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={locked}
      onClick={onSelect}
      className={clsx(
        'flex w-full items-start gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors',
        checked ? 'border-accent bg-accent-soft/60' : 'border-line hover:border-line-strong',
        locked && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        className={clsx(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
          checked ? 'border-accent' : 'border-line-strong',
        )}
      >
        {checked ? <span className="size-2 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-[500] text-ink">{title}</span>
          {locked ? (
            <Badge>
              <LockIcon size={11} /> {lockedReason ? 'Unavailable' : 'Paid plan'}
            </Badge>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-muted">
          {lockedReason ?? description}
        </span>
      </span>
    </button>
  );
}
