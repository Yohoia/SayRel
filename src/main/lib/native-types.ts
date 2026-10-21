/**
 * Type-safe FFI bindings for native Swift code
 *
 * This file provides TypeScript type definitions for all native functions,
 * replacing the previous `any` types with proper type safety.
 */

// ===== Native Function Signatures =====

export interface NativeKeyEvent {
  key: string
  pressed: boolean
  combination: string
  ts: number
  replacedCombination?: string
  capture?: boolean
  cancelled?: boolean
}

export interface NativeKeyCallback {
  (event: NativeKeyEvent): void
}

export interface NativePermissionStatus {
  microphone: boolean
  accessibility: boolean
  screenRecording: boolean
}

export interface NativeAudioDevice {
  deviceId: string
  name: string
  manufacturer?: string
  isDefault: boolean
}

// ===== Koffi Function Types =====

export type KoffiPointer = unknown // Opaque pointer type
export type KoffiFunction<TArgs extends any[] = any[], TReturn = any> = (...args: TArgs) => TReturn

// ===== Native Module Interface =====

export interface NativeKeyboardModule {
  /**
   * Start monitoring keyboard events
   * @param callback Function to receive key events
   * @returns Success status
   */
  startMonitoring(callback: KoffiPointer): boolean

  /**
   * Stop monitoring keyboard events
   * @returns Success status
   */
  stopMonitoring(): boolean

  /**
   * Check if monitoring is active
   */
  isMonitoring(): boolean
}

export interface NativeAudioModule {
  /**
   * List all available audio input devices
   */
  listInputDevices(): NativeAudioDevice[]

  /**
   * Get current default input device
   */
  getDefaultInputDevice(): NativeAudioDevice | null

  /**
   * Set the input device to use
   */
  setInputDevice(deviceId: string): boolean

  /**
   * Get current system audio mute status
   */
  isMuted(): boolean

  /**
   * Mute system audio
   */
  mute(): boolean

  /**
   * Unmute system audio
   */
  unmute(): boolean
}

export interface NativePermissionsModule {
  /**
   * Check if a specific permission is granted
   */
  checkPermission(type: 'microphone' | 'accessibility' | 'screenRecording'): boolean

  /**
   * Request a specific permission (may show system dialog)
   */
  requestPermission(type: 'microphone' | 'accessibility' | 'screenRecording'): Promise<boolean>

  /**
   * Get status of all permissions
   */
  getPermissionStatus(): NativePermissionStatus
}

export interface NativeScreenCaptureModule {
  /**
   * Capture visible text from focused window
   */
  captureVisibleText(): Promise<string | null>

  /**
   * Get information about the focused application
   */
  getFocusedAppInfo(): {
    appName: string | null
    bundleId: string | null
    windowTitle: string | null
  }
}

// ===== Combined Native API =====

export interface NativeAPI {
  keyboard: NativeKeyboardModule
  audio: NativeAudioModule
  permissions: NativePermissionsModule
  screenCapture: NativeScreenCaptureModule

  /**
   * Check if native module is available and loaded
   */
  isAvailable(): boolean

  /**
   * Get native module version
   */
  getVersion(): string
}

// ===== Error Types =====

export class NativeModuleError extends Error {
  constructor(
    message: string,
    public module: string,
    public nativeError?: unknown
  ) {
    super(message)
    this.name = 'NativeModuleError'
  }
}

export class NativeModuleNotAvailableError extends Error {
  constructor(public module: string) {
    super(`Native module not available: ${module}`)
    this.name = 'NativeModuleNotAvailableError'
  }
}

// ===== Type Guards =====

export function isValidKeyEvent(obj: unknown): obj is NativeKeyEvent {
  if (!obj || typeof obj !== 'object') return false

  const event = obj as any
  return (
    typeof event.key === 'string' &&
    typeof event.pressed === 'boolean' &&
    typeof event.combination === 'string' &&
    typeof event.ts === 'number'
  )
}

export function isValidAudioDevice(obj: unknown): obj is NativeAudioDevice {
  if (!obj || typeof obj !== 'object') return false

  const device = obj as any
  return (
    typeof device.deviceId === 'string' &&
    typeof device.name === 'string' &&
    typeof device.isDefault === 'boolean'
  )
}

// ===== Usage Example =====

/*
// ✅ Before: Unsafe any types
const bind: any = native?.lib?.symbols?.BindKeyEventCallback
bind?.(callback)

// ✅ After: Type-safe
const keyboard: NativeKeyboardModule = native.keyboard
const success = keyboard.startMonitoring(callbackPointer)
if (!success) {
  throw new NativeModuleError('Failed to start monitoring', 'keyboard')
}
*/
