/**
 * Zod schemas for validating external API responses.
 *
 * These schemas ensure that data from untrusted sources (network APIs)
 * is validated before being used in the application.
 */

import { z } from 'zod'

/**
 * OAuth token response schema
 */
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional()
})

export type TokenResponse = z.infer<typeof TokenResponseSchema>

/**
 * User info response schema
 */
export const UserInfoResponseSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().url().nullable().optional(),
  plan: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  createdAt: z.string().datetime().nullable().optional()
}).transform(data => ({
  ...data,
  avatarUrl: data.avatarUrl ?? null,
  plan: data.plan ?? null,
  locale: data.locale ?? null,
  createdAt: data.createdAt ?? null
}))

export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>

/**
 * Sync history item response schema
 */
export const SyncHistoryItemSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  mode: z.string(),
  text: z.string(),
  result: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
})

export const SyncHistoryResponseSchema = z.object({
  items: z.array(SyncHistoryItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive().optional(),
  hasMore: z.boolean().optional()
})

export type SyncHistoryResponse = z.infer<typeof SyncHistoryResponseSchema>

/**
 * Generic API error response schema
 */
export const ApiErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  error_uri: z.string().url().optional(),
  status: z.number().int().optional()
})

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>

/**
 * Helper to safely parse and validate API responses
 */
export function validateApiResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string
): T {
  try {
    return schema.parse(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
      throw new Error(`Invalid ${context} response: ${issues}`)
    }
    throw err
  }
}

/**
 * Helper to safely parse API responses that might be errors
 */
export function parseApiResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string
): T {
  // Try to parse as error first
  const errorResult = ApiErrorResponseSchema.safeParse(data)
  if (errorResult.success) {
    throw new Error(
      errorResult.data.error_description ||
      errorResult.data.error ||
      `API error in ${context}`
    )
  }

  // Parse as success response
  return validateApiResponse(schema, data, context)
}
