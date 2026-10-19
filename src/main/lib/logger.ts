import { createWriteStream, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let stream: WriteStream | null = null
let minLevel: Level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'

function streamFor(): WriteStream {
  if (!stream) {
    stream = createWriteStream(join(paths.logs, 'main.log'), { flags: 'a' })
  }
  return stream
}

function write(level: Level, scope: string, message: string, extra?: unknown) {
  if (LEVELS[level] < LEVELS[minLevel]) return
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    scope,
    message,
    ...(extra === undefined ? {} : { extra })
  })
  // eslint-disable-next-line no-console
  ;(level === 'error' ? console.error : console.log)(line)
  try {
    streamFor().write(line + '\n')
  } catch {
    /* logging must never throw */
  }
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => write('debug', scope, m, e),
    info: (m: string, e?: unknown) => write('info', scope, m, e),
    warn: (m: string, e?: unknown) => write('warn', scope, m, e),
    error: (m: string, e?: unknown) => write('error', scope, m, e),
    setLevel: (l: Level) => {
      minLevel = l
    }
  }
}

export type Logger = ReturnType<typeof createLogger>
