import type { CompanionStatus } from '@companion/shared';
import { Badge, Dot } from './primitives';

const STATUS_LABEL: Record<CompanionStatus, string> = {
  DRAFT: 'Draft',
  PROCESSING: 'Preparing',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  ARCHIVED: 'Archived',
  FAILED: 'Needs attention',
};

const STATUS_TONE: Record<CompanionStatus, 'neutral' | 'accent' | 'success' | 'danger' | 'warning'> = {
  DRAFT: 'neutral',
  PROCESSING: 'accent',
  ACTIVE: 'success',
  PAUSED: 'warning',
  EXPIRED: 'neutral',
  REVOKED: 'danger',
  ARCHIVED: 'neutral',
  FAILED: 'danger',
};

export function StatusBadge({ status }: { status: CompanionStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <Dot tone={STATUS_TONE[status]} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function statusLabel(status: CompanionStatus): string {
  return STATUS_LABEL[status];
}
