/**
 * Structured logging system
 *
 * Replaces console.log with structured, searchable logs
 * that include context, severity, and metadata.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export interface LogContext {
  [key: string]: unknown
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  levelName: string
  module: string
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, error?: Error, context?: LogContext): void
  fatal(message: string, error?: Error, context?: LogContext): void
}

class StructuredLogger implements Logger {
  constructor(
    private module: string,
    private minLevel: LogLevel = LogLevel.INFO
  ) {}

  private shouldLog(level: LogLevel): boolean {
    return level >= this.minLevel
  }

  private formatEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      levelName: LogLevel[level],
      module: this.module,
      message,
      context
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    }

    return entry
  }

  private log(entry: LogEntry): void {
    const output = JSON.stringify(entry)

    switch (entry.level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(output)
        break
      case LogLevel.WARN:
        console.warn(output)
        break
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(output)
        break
    }
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return
    this.log(this.formatEntry(LogLevel.DEBUG, message, context))
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.INFO)) return
    this.log(this.formatEntry(LogLevel.INFO, message, context))
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.WARN)) return
    this.log(this.formatEntry(LogLevel.WARN, message, context))
  }

  error(message: string, error?: Error, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.ERROR)) return
    this.log(this.formatEntry(LogLevel.ERROR, message, context, error))
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.FATAL)) return
    this.log(this.formatEntry(LogLevel.FATAL, message, context, error))
  }
}

// ===== Logger Factory =====

const loggers = new Map<string, Logger>()

export function createStructuredLogger(module: string, minLevel?: LogLevel): Logger {
  const key = `${module}:${minLevel ?? LogLevel.INFO}`

  if (!loggers.has(key)) {
    loggers.set(key, new StructuredLogger(module, minLevel))
  }

  return loggers.get(key)!
}

// ===== Configuration =====

let globalMinLevel = LogLevel.INFO

export function setGlobalLogLevel(level: LogLevel): void {
  globalMinLevel = level
}

export function getGlobalLogLevel(): LogLevel {
  return globalMinLevel
}

// ===== Usage Examples =====

/*
// ✅ Basic usage
const log = createStructuredLogger('auth')

log.info('User login started', { userId: 'user123' })
// Output: {"timestamp":"2024-10-20T...","level":1,"levelName":"INFO","module":"auth","message":"User login started","context":{"userId":"user123"}}

// ✅ Error logging
try {
  throw new Error('Token expired')
} catch (err) {
  log.error('Login failed', err as Error, { userId: 'user123' })
}

// ✅ Performance tracking
const startTime = Date.now()
// ... operation
log.info('Operation completed', {
  duration: Date.now() - startTime,
  operation: 'fetch-user'
})

// ✅ Debug logging (only when DEBUG level enabled)
log.debug('Request details', {
  url: '/api/users',
  method: 'GET',
  headers: { ... }
})
*/

// ===== Migration Helper =====

/**
 * Wrapper to gradually migrate from console.log to structured logging
 */
export function wrapConsoleLogger(module: string): {
  log: (message: string, ...args: any[]) => void
  info: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
} {
  const logger = createStructuredLogger(module)

  return {
    log: (message: string, ...args: any[]) => {
      logger.info(message, args.length > 0 ? { args } : undefined)
    },
    info: (message: string, ...args: any[]) => {
      logger.info(message, args.length > 0 ? { args } : undefined)
    },
    warn: (message: string, ...args: any[]) => {
      logger.warn(message, args.length > 0 ? { args } : undefined)
    },
    error: (message: string, ...args: any[]) => {
      const error = args.find(arg => arg instanceof Error)
      const otherArgs = args.filter(arg => !(arg instanceof Error))
      logger.error(message, error, otherArgs.length > 0 ? { args: otherArgs } : undefined)
    }
  }
}
