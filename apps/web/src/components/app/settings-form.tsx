'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import { Button } from '../ui/button';
import { TextInput } from '../ui/fields';
import { Card, SectionHeading } from '../ui/primitives';
import { CheckIcon } from '../ui/icons';

export function SettingsForm({
  initial,
}: {
  initial: { name: string; email: string; workspaceName: string; senderLabel: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [workspaceName, setWorkspaceName] = useState(initial.workspaceName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState<'profile' | 'password' | null>(null);
  const [saved, setSaved] = useState<'profile' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('profile');
    setError(null);
    setSaved(null);
    try {
      await apiFetch('/api/account', { method: 'PATCH', json: { name, workspaceName } });
      setSaved('profile');
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('password');
    setError(null);
    setSaved(null);
    try {
      await apiFetch('/api/account/password', {
        method: 'POST',
        json: { currentPassword, newPassword },
      });
      setSaved('password');
      setCurrentPassword('');
      setNewPassword('');
      // Changing a password revokes every session, including this one.
      window.location.href = '/login';
    } catch (passwordError) {
      setError(
        passwordError instanceof ApiError ? passwordError.message : 'Could not change the password.',
      );
      setBusy(null);
    }
  };

  return (
    <>
      <Card className="mt-7">
        <SectionHeading
          title="Your details"
          description="Your workspace name is what recipients see as “Shared by”."
        />
        <form onSubmit={saveProfile} className="mt-5 space-y-4">
          <TextInput label="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <TextInput label="Email" value={initial.email} disabled />
          <TextInput
            label="Workspace name"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            hint="Shown to recipients as the sender."
          />
          <div className="flex items-center gap-3">
            <Button type="submit" loading={busy === 'profile'}>
              Save
            </Button>
            {saved === 'profile' ? (
              <span className="flex items-center gap-1.5 text-[13px] text-success">
                <CheckIcon size={15} /> Saved
              </span>
            ) : null}
          </div>
        </form>
      </Card>

      <Card className="mt-6">
        <SectionHeading
          title="Password"
          description="Changing your password signs you out everywhere."
        />
        <form onSubmit={changePassword} className="mt-5 space-y-4">
          <TextInput
            type="password"
            label="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <TextInput
            type="password"
            label="New password"
            autoComplete="new-password"
            required
            minLength={10}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            hint="At least 10 characters."
          />
          <Button type="submit" variant="secondary" loading={busy === 'password'}>
            Change password
          </Button>
        </form>
      </Card>

      {error ? (
        <p role="alert" className="mt-4 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}
