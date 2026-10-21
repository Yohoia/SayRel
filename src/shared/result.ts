/**
 * Unified error handling with Result type
 *
 * Provides a type-safe way to handle errors without exceptions,
 * following the "parse, don't validate" principle.
 */

// ===== Result Type =====

export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E }

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>

// ===== Constructors =====

export function ok<T>(value: T): Result<T, never> {
  return { success: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { success: false, error }
}

// ===== Type Guards =====

export function isOk<T, E>(result: Result<T, E>): result is { success: true; value: T } {
  return result.success === true
}

export function isErr<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return result.success === false
}

// ===== Utilities =====

/**
 * Extract value or throw error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value
  }
  throw result.error
}

/**
 * Extract value or return default
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isOk(result)) {
    return result.value
  }
  return defaultValue
}

/**
 * Extract value or compute default from error
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  if (isOk(result)) {
    return result.value
  }
  return fn(result.error)
}

/**
 * Map over the success value
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.value))
  }
  return result
}

/**
 * Map over the error value
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (isErr(result)) {
    return err(fn(result.error))
  }
  return result
}

/**
 * Chain operations that return Results
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (isOk(result)) {
    return fn(result.value)
  }
  return result
}

/**
 * Match on Result and return a value for both cases
 */
export function match<T, E, U>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => U
    err: (error: E) => U
  }
): U {
  if (isOk(result)) {
    return handlers.ok(result.value)
  }
  return handlers.err(result.error)
}

// ===== Error Types =====

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class NetworkError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message)
    this.name = 'NetworkError'
  }
}


export class NotFoundError extends Error {
  constructor(
    message: string,
    public resourceType?: string,
    public resourceId?: string
  ) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncryptionError'
  }
}

// ===== Try/Catch Wrapper =====

/**
 * Wraps a function that might throw into a Result
 */
export function tryCatch<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn())
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Wraps an async function that might throw into an AsyncResult
 */
export async function tryCatchAsync<T>(fn: () => Promise<T>): AsyncResult<T, Error> {
  try {
    const value = await fn()
    return ok(value)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

// ===== Usage Examples =====
