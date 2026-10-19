import koffi from 'koffi'
import { join } from 'node:path'
import { paths } from './paths'
import { createLogger } from './logger'

const log = createLogger('native')

type AnyFn = (...args: any[]) => any
// koffi accepts string type names or IKoffiCType instances; keep the helper loose.
type CType = any

function loadLib(name: string): any | null {
  const file = join(paths.helpers, name, 'build', `lib${name}.dylib`)
  try {
    return koffi.load(file)
  } catch (err) {
    log.error(`failed to load ${file}`, err)
    return null
  }
}

const libs = {
  input: loadLib('InputHelper'),
  keyboard: loadLib('KeyboardHelper'),
  context: loadLib('ContextHelper'),
  util: loadLib('UtilHelper')
}

function fn(lib: any, name: string, ret: CType, args: CType[]): AnyFn | null {
  if (!lib) return null
  try {
    return lib.func(name, ret, args) as AnyFn
  } catch (err) {
    log.error(`failed to bind ${name}`, err)
    return null
  }
}

/** Raw string returns need manual free; koffi's `str` conversion copies them. */
function readString(ptr: unknown): string | null {
  if (!ptr) return null
  if (typeof ptr === 'string') return ptr
  try {
    return koffi.decode(ptr as any, 'char', -1) as string
  } catch {
    return null
  }
}

const freeString = fn(libs.util ?? libs.input, 'freeString', 'void', ['void *'])

// ---------------------------------------------------------------- input

export const input = {
  available: !!libs.input,
  insertText: fn(libs.input, 'insertText', 'int', ['char *']) as ((t: string) => number) | null,
  insertRichText: fn(libs.input, 'insertRichText', 'int', ['char *', 'char *']) as
    | ((html: string, text: string) => number)
    | null,
  deleteBackward: fn(libs.input, 'deleteBackward', 'int', ['int']) as ((n: number) => number) | null,
  getSelectedText: fn(libs.input, 'getSelectedText', 'str', ['int']) as ((t: number) => string) | null,
  getCurrentInputState: fn(libs.input, 'getCurrentInputState', 'str', ['int']) as
    | ((t: number) => string)
    | null,
  checkAccessibilityPermission: fn(libs.input, 'checkAccessibilityPermission', 'int', ['int']) as
    | ((prompt: number) => number)
    | null
}

// ------------------------------------------------------------- keyboard

export type KeyEvent = {
  key: string
  pressed: boolean
  combination: string
  ts: number
  /** A more specific chord within the same physical gesture. */
  replacedCombination?: string
  /** The native tap reset or stopped while keys were held. */
  capture?: boolean
  cancelled?: boolean
}

const keyboardCallback = koffi.proto('void KeyboardEventCallback(char *)')
const keyListeners = new Set<(e: KeyEvent) => void>()
let keyboardMonitorStarted = false

function emitKey(raw: unknown) {
  const text = typeof raw === 'string' ? raw : readString(raw)
  if (!text) return
  try {
    const event = JSON.parse(text) as KeyEvent
    for (const listener of keyListeners) listener(event)
  } catch (err) {
    log.error('bad keyboard event payload', err)
  }
}

const callbackImpl = koffi.register((raw: unknown) => emitKey(raw), koffi.pointer(keyboardCallback))

export const keyboard = {
  setShortcutCaptureEnabled: fn(libs.keyboard, 'setShortcutCaptureEnabled', 'int', ['int']) as ((enabled: number) => number) | null,
  available: !!libs.keyboard,
  start(): number {
    if (keyboardMonitorStarted) return 0
    const startFn = fn(libs.keyboard, 'startMonitor', 'int', [koffi.pointer(keyboardCallback)])
    if (!startFn) return -1
    const result = startFn(callbackImpl)
    keyboardMonitorStarted = result === 0
    return result
  },
  stop(): void {
    const stopFn = fn(libs.keyboard, 'stopMonitor', 'int', [])
    stopFn?.()
    keyboardMonitorStarted = false
  },
  setWatcherInterval: fn(libs.keyboard, 'setWatcherInterval', 'int', ['int']) as
    | ((ms: number) => number)
    | null,
  updateTargetShortcuts: fn(libs.keyboard, 'updateTargetShortcuts', 'int', ['char *']) as
    | ((json: string) => number)
    | null,
  resetPressingKeycodes: fn(libs.keyboard, 'resetPressingKeycodes', 'int', []) as (() => number) | null,
  getDeviceList: fn(libs.keyboard, 'getKeyboardDeviceList', 'str', []) as (() => string) | null,
  onKey(listener: (e: KeyEvent) => void): () => void {
    keyListeners.add(listener)
    return () => keyListeners.delete(listener)
  },
  get running(): boolean {
    return keyboardMonitorStarted
  }
}

// -------------------------------------------------------------- context

const contextCallback = koffi.proto('void ContextStringCallback(char *)')

function asyncStringCall(
  fname: string,
  timeoutMs = 2000
): Promise<any | null> {
  return new Promise((resolve) => {
    const bind = fn(libs.context, fname, 'void', [koffi.pointer(contextCallback)])
    if (!bind) return resolve(null)
    let settled = false
    const done = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        resolve(value ? JSON.parse(value) : null)
      } catch {
        resolve(null)
      }
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    const cb = koffi.register((raw: unknown) => done(readString(raw)), koffi.pointer(contextCallback))
    try {
      bind(cb)
    } catch (err) {
      log.error(`${fname} failed`, err)
      done(null)
    }
  })
}

export const context = {
  available: !!libs.context,
  getFocusedAppInfo: () => asyncStringCall('getFocusedAppInfoAsync'),
  getFocusedElementInfo: () => asyncStringCall('getFocusedElementInfoAsync'),
  getFocusedElementRelatedContent: () => asyncStringCall('getFocusedElementRelatedContentAsync', 3000),
  getFocusedVisibleText: () => asyncStringCall('getFocusedVisibleTextAsync', 4000),
  setFocusedWindowEnhancedUserInterface:
    (fn(libs.context, 'setFocusedWindowEnhancedUserInterface', 'int', ['int']) as
      | ((on: number) => number)
      | null) ?? null
}

// ----------------------------------------------------------------- util

export const util = {
  available: !!libs.util,
  checkAccessibilityPermission: fn(libs.util, 'checkAccessibilityPermission', 'int', ['int']) as
    | ((prompt: number) => number)
    | null,
  deviceIsLidOpen: fn(libs.util, 'deviceIsLidOpen', 'int', []) as (() => number) | null,
  getDeviceId: fn(libs.util, 'getDeviceId', 'str', []) as (() => string) | null,
  getAudioDevicesJSON: fn(libs.util, 'getAudioDevicesJSON', 'str', []) as (() => string) | null,
  getAudioDevicesJSONAsync: () =>
    new Promise<any[]>((resolve) => {
      const bind = fn(libs.util, 'getAudioDevicesJSONAsync', 'void', [koffi.pointer(contextCallback)])
      if (!bind) return resolve([])
      const cb = koffi.register((raw: unknown) => {
        const text = readString(raw)
        try {
          resolve(text ? JSON.parse(text) : [])
        } catch {
          resolve([])
        }
      }, koffi.pointer(contextCallback))
      bind(cb)
    }),
  isAudioMuted: fn(libs.util, 'isAudioMuted', 'int', []) as (() => number) | null,
  muteAudio: fn(libs.util, 'muteAudio', 'int', []) as (() => number) | null,
  unmuteAudio: fn(libs.util, 'unmuteAudio', 'int', []) as (() => number) | null,
  launchApplicationByName: fn(libs.util, 'launchApplicationByName', 'int', ['char *']) as
    | ((name: string) => number)
    | null
}

export const nativeStatus = {
  input: input.available,
  keyboard: keyboard.available,
  context: context.available,
  util: util.available
}

export { freeString }
