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

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthenticationError'
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

/*
// ✅ Example 1: Basic usage
function divide(a: number, b: number): Result<number, string> {
  if (b === 0) {
    return err('Division by zero')
  }
  return ok(a / b)
}

const result = divide(10, 2)
if (isOk(result)) {
  console.log(result.value) // 5
} else {
  console.error(result.error)
}

// ✅ Example 2: Using match
const message = match(divide(10, 0), {
  ok: (value) => `Result: ${value}`,
  err: (error) => `Error: ${error}`
})

// ✅ Example 3: Chaining operations
const result = divide(10, 2)
  .andThen(value => divide(value, 5))
  .map(value => value * 2)

// ✅ Example 4: Network request
async function fetchUser(id: string): AsyncResult<User, NetworkError> {
  return tryCatchAsync(async () => {
    const response = await fetch(`/api/users/${id}`)
    if (!response.ok) {
      throw new NetworkError('Failed to fetch user', response.status)
    }
    return response.json()
  })
}

const userResult = await fetchUser('123')
const user = unwrapOr(userResult, { id: '0', name: 'Guest' })

// ✅ Example 5: Validation
function validateEmail(email: string): Result<string, ValidationError> {
  if (!email.includes('@')) {
    return err(new ValidationError('Invalid email format', 'email'))
  }
  return ok(email)
}
*/
