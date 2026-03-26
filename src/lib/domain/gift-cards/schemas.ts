/**
 * Gift Card Zod Validation Schemas
 *
 * Central validation for all gift card domain inputs.
 * Used by API route handlers to validate request bodies before
 * passing clean data to domain commands.
 */

import { z } from 'zod'

// ─── Adjust Balance ──────────────────────────────────────────────────────────

export const adjustBalanceSchema = z.object({
  amount: z.number(),
  notes: z.string().min(1, 'Notes are required for balance adjustments'),
})

export type AdjustBalanceInput = z.infer<typeof adjustBalanceSchema>

// ─── Activate Card ───────────────────────────────────────────────────────────

export const activateCardSchema = z.object({
  amount: z.number().positive('Activation amount must be positive'),
  recipientName: z.string().optional(),
  recipientEmail: z.string().email('Invalid email format').optional(),
  recipientPhone: z.string().optional(),
  purchaserName: z.string().optional(),
  message: z.string().optional(),
})

export type ActivateCardInput = z.infer<typeof activateCardSchema>

// ─── Import Cards ────────────────────────────────────────────────────────────

export const importCardsSchema = z.object({
  cardNumbers: z.array(
    z.string()
      .min(4, 'Card number must be at least 4 characters')
      .max(30, 'Card number must be at most 30 characters')
      .regex(/^[A-Za-z0-9-]+$/, 'Card number must be alphanumeric (dashes allowed)')
  ),
  pins: z.array(z.string()).optional(),
})

export type ImportCardsInput = z.infer<typeof importCardsSchema>

// ─── Generate Range ──────────────────────────────────────────────────────────

export const generateRangeSchema = z.object({
  prefix: z.string()
    .min(1, 'Prefix is required')
    .max(10, 'Prefix must be at most 10 characters')
    .regex(/^[A-Za-z0-9]+$/, 'Prefix must be alphanumeric'),
  start: z.number().int().positive('Start must be a positive integer'),
  end: z.number().int(),
  zeroPad: z.number().int().min(4).max(10).default(4),
  dryRun: z.boolean().optional(),
}).refine(data => data.end >= data.start, {
  message: 'End must be >= start',
  path: ['end'],
})

export type GenerateRangeInput = z.infer<typeof generateRangeSchema>

// ─── Freeze Card ─────────────────────────────────────────────────────────────

export const freezeCardSchema = z.object({
  reason: z.string().min(1, 'Reason is required for freezing a card'),
})

export type FreezeCardInput = z.infer<typeof freezeCardSchema>

// ─── Batch Action ────────────────────────────────────────────────────────────

export const batchActionSchema = z.object({
  action: z.enum(['activate', 'freeze', 'unfreeze', 'delete']),
  cardIds: z.array(z.string()).min(1, 'At least one card ID is required'),
  amount: z.number().optional(),
  reason: z.string().optional(),
})

export type BatchActionInput = z.infer<typeof batchActionSchema>
