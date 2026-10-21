/**
 * Branded types for preventing ID confusion
 *
 * Branded types use TypeScript's structural typing to create
 * nominal types that can't be accidentally mixed up.
 */

// ===== Brand utility =====

declare const __brand: unique symbol
type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand }

// ===== ID Types =====

export type SessionId = Brand<string, 'SessionId'>
export type HistoryId = Brand<string, 'HistoryId'>
export type DictionaryId = Brand<string, 'DictionaryId'>
export type DeviceId = Brand<string, 'DeviceId'>
export type BundleId = Brand<string, 'BundleId'>

// ===== Type Guards (验证函数) =====


export function isSessionId(value: string): value is SessionId {
  return /^[a-zA-Z0-9_-]+$/.test(value) && value.length > 0
}

export function isHistoryId(value: string): value is HistoryId {
  return /^[a-zA-Z0-9_-]+$/.test(value) && value.length > 0
}

export function isDictionaryId(value: string): value is DictionaryId {
  return /^[a-zA-Z0-9_-]+$/.test(value) && value.length > 0
}

export function isDeviceId(value: string): value is DeviceId {
  return value.length > 0
}

export function isBundleId(value: string): value is BundleId {
  // Bundle IDs follow reverse domain name notation
  return /^[a-zA-Z0-9.-]+$/.test(value) && value.includes('.')
}

// ===== Constructor Functions (安全创建) =====


export function createSessionId(value: string): SessionId {
  if (!isSessionId(value)) {
    throw new Error(`Invalid SessionId: ${value}`)
  }
  return value as SessionId
}

export function createHistoryId(value: string): HistoryId {
  if (!isHistoryId(value)) {
    throw new Error(`Invalid HistoryId: ${value}`)
  }
  return value as HistoryId
}

export function createDictionaryId(value: string): DictionaryId {
  if (!isDictionaryId(value)) {
    throw new Error(`Invalid DictionaryId: ${value}`)
  }
  return value as DictionaryId
}

export function createDeviceId(value: string): DeviceId {
  if (!isDeviceId(value)) {
    throw new Error(`Invalid DeviceId: ${value}`)
  }
  return value as DeviceId
}

export function createBundleId(value: string): BundleId {
  if (!isBundleId(value)) {
    throw new Error(`Invalid BundleId: ${value}`)
  }
  return value as BundleId
}

// ===== Unsafe Constructors (仅用于信任的源) =====

/**
 * Unsafe cast - only use when you're certain the value is valid
 * (e.g., from database, already validated)
 */

export function unsafeSessionId(value: string): SessionId {
  return value as SessionId
}

export function unsafeHistoryId(value: string): HistoryId {
  return value as HistoryId
}

export function unsafeDictionaryId(value: string): DictionaryId {
  return value as DictionaryId
}

export function unsafeDeviceId(value: string): DeviceId {
  return value as DeviceId
}

export function unsafeBundleId(value: string): BundleId {
  return value as BundleId
}

// ===== Usage Examples =====
