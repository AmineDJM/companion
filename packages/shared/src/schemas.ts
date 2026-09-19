import { z } from 'zod';
import {
  ACCESS_MODES,
  ANALYTICS_EVENT_TYPES,
  BILLING_INTERVALS,
  PLAN_KEYS,
  SOURCE_PROTECTION_MODES,
  USAGE_ADJUSTMENT_TYPES,
  COMPANION_STATUSES,
} from './constants.js';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120).optional(),
  /** Optional draft handoff: resumes an upload started before signing up. */
  draftToken: z.string().max(200).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  draftToken: z.string().max(200).optional(),
});

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
  draftToken: z.string().max(200).optional(),
});

export const companionNameSchema = z.string().trim().min(1).max(140);

export const expirationPresetSchema = z.enum(['never', '24h', '7d', '30d', 'custom']);

export const brandingSchema = z.object({
  showCompanionBranding: z.boolean().default(true),
  senderLabel: z.string().trim().max(120).nullable().default(null),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #6374FF')
    .nullable()
    .default(null),
  logoUrl: z.string().url().max(2000).nullable().default(null),
});
export type Branding = z.infer<typeof brandingSchema>;

export const DEFAULT_BRANDING: Branding = {
  showCompanionBranding: true,
  senderLabel: null,
  accentColor: null,
  logoUrl: null,
};

export const accessPolicyInputSchema = z
  .object({
    accessMode: z.enum(ACCESS_MODES),
    password: z.string().min(4).max(200).nullable().optional(),
    allowedEmails: z.array(emailSchema).max(500).optional(),
    allowedDomains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Enter a domain such as acme.com'),
      )
      .max(50)
      .optional(),
    expirationPreset: expirationPresetSchema.optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    downloadAllowed: z.boolean().optional(),
    sourceProtectionMode: z.enum(SOURCE_PROTECTION_MODES).optional(),
    aiEnabled: z.boolean().optional(),
  })
  .refine(
    (value) => value.accessMode !== 'EMAIL_LIST' || (value.allowedEmails?.length ?? 0) > 0 || (value.allowedDomains?.length ?? 0) > 0,
    { message: 'Add at least one email address or domain.', path: ['allowedEmails'] },
  )
  .refine((value) => value.expirationPreset !== 'custom' || value.expiresAt instanceof Date, {
    message: 'Choose an expiration date.',
    path: ['expiresAt'],
  });

export type AccessPolicyInput = z.infer<typeof accessPolicyInputSchema>;

export const createCompanionSchema = z.object({
  name: companionNameSchema.optional(),
  draftToken: z.string().max(200).optional(),
});

export const updateCompanionSchema = z.object({
  name: companionNameSchema.optional(),
  defaultFileId: z.string().uuid().nullable().optional(),
  branding: brandingSchema.partial().optional(),
});

export const uploadIntentSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(400),
        size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        contentType: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const askQuestionSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(1_500),
  conversationId: z.string().uuid().nullable().optional(),
  context: z
    .object({
      fileId: z.string().uuid().nullable().optional(),
      page: z.number().int().positive().nullable().optional(),
      sheet: z.string().max(200).nullable().optional(),
      slide: z.number().int().positive().nullable().optional(),
      selection: z.string().max(2_000).nullable().optional(),
    })
    .optional(),
});
export type AskQuestionInput = z.infer<typeof askQuestionSchema>;

export const unlockSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  email: emailSchema.optional(),
  code: z.string().trim().length(6).optional(),
});

export const analyticsEventSchema = z.object({
  type: z.enum(ANALYTICS_EVENT_TYPES),
  fileId: z.string().uuid().nullable().optional(),
  page: z.number().int().positive().nullable().optional(),
  /** Milliseconds spent on the unit, for dwell-time aggregation. */
  durationMs: z.number().int().nonnegative().max(1000 * 60 * 60).nullable().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

export const checkoutSchema = z.object({
  planKey: z.enum(PLAN_KEYS),
  interval: z.enum(BILLING_INTERVALS),
});

export const adminQuotaAdjustmentSchema = z.object({
  workspaceId: z.string().uuid(),
  type: z.enum(USAGE_ADJUSTMENT_TYPES),
  /** Number of questions granted (positive) or removed (negative). */
  amount: z.number().int().refine((value) => value !== 0, 'Enter a non-zero amount.'),
  reason: z.string().trim().min(3, 'A reason is required.').max(500),
  expiresAt: z.coerce.date().nullable().optional(),
  recurring: z.boolean().default(false),
});
export type AdminQuotaAdjustmentInput = z.infer<typeof adminQuotaAdjustmentSchema>;

export const adminPlanChangeSchema = z.object({
  workspaceId: z.string().uuid(),
  planKey: z.enum(PLAN_KEYS),
  reason: z.string().trim().min(3).max(500),
  /** When set the override reverts automatically. */
  expiresAt: z.coerce.date().nullable().optional(),
});

export const adminNoteSchema = z.object({
  workspaceId: z.string().uuid(),
  body: z.string().trim().min(1).max(4_000),
});

export const adminWorkspaceStatusSchema = z.object({
  workspaceId: z.string().uuid(),
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().min(3).max(500),
});

export const adminCompanionActionSchema = z.object({
  companionId: z.string().uuid(),
  action: z.enum(['pause', 'reactivate', 'revoke', 'force_expire', 'reprocess']),
  reason: z.string().trim().min(3).max(500),
});

export const adminFeatureFlagSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,60}$/, 'Use lowercase snake_case.'),
  description: z.string().trim().max(500).optional(),
  enabledGlobally: z.boolean(),
  enabledPlans: z.array(z.enum(PLAN_KEYS)).default([]),
  enabledWorkspaceIds: z.array(z.string().uuid()).default([]),
});

export const adminSearchSchema = z.object({
  q: z.string().trim().min(1).max(200),
});

export const companionFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(COMPANION_STATUSES).optional(),
  sort: z.enum(['updated', 'created', 'name', 'views', 'questions']).default('updated'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
