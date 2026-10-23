/**
 * Canonical IPC channel names.
 *
 * Kept in one place so that main, preload and renderer cannot drift apart.
 * Channels are grouped by domain with a `domain:action` shape.
 */
export const IPC = {
  // appearance
  APPEARANCE_GET_COLOR_MODE: 'appearance:get-color-mode',
  APPEARANCE_GET_STATE: 'appearance:get-state',
  APPEARANCE_SET_PREFERENCE: 'appearance:set-preference',
  APPEARANCE_COLOR_MODE_CHANGED: 'appearance:color-mode-changed',

  // app
  APP_RESTART: 'app:restart',

  // audio capture + encoding
  AUDIO_GET_DEVICES_ASYNC: 'audio:get-devices-async',
  AUDIO_IS_MUTED: 'audio:is-muted',
  AUDIO_MUTE: 'audio:mute',
  AUDIO_UNMUTE: 'audio:unmute',
  AUDIO_OPUS_COMPRESS_BY_BUFFER: 'audio:opus-compress-by-buffer',
  AUDIO_OPUS_COMPRESS_BY_AUDIO_ID: 'audio:opus-compress-by-audio-id',
  AUDIO_OPUS_CHUNK_SESSION_START: 'audio:opus-chunk-session-start',
  AUDIO_OPUS_CHUNK_SESSION_ENCODE: 'audio:opus-chunk-session-encode',
  AUDIO_OPUS_CHUNK_SESSION_END: 'audio:opus-chunk-session-end',
  AUDIO_CLEAN_OPUS_AUDIO_FILE: 'audio:clean-opus-audio-file',
  AUDIO_AI_VOICE_FLOW: 'audio:ai-voice-flow',
  AUDIO_ABORT_AI_VOICE_FLOW_REQUEST: 'audio:abort-ai-voice-flow-request',

  // clipboard
  CLIPBOARD_WRITE_IMAGE: 'clipboard:write-image',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',

  // context capture
  CONTEXT_GET_APP_ICON: 'context:get-app-icon',

  // database / history
  DB_GET_DEVICE_ID: 'db:get-device-id',
  DB_HISTORY_CLEAR: 'db:history-clear',
  DB_HISTORY_DELETE: 'db:history-delete',
  DB_HISTORY_DELETE_BY_DURATION: 'db:history-delete-by-duration',
  DB_HISTORY_GET: 'db:history-get',
  DB_HISTORY_LATEST: 'db:history-latest',
  DB_HISTORY_LATEST_ID: 'db:history-latest-id',
  DB_HISTORY_LATEST_ID_FOR_ERROR_TRACKING: 'db:history-latest-id-for-error-tracking',
  DB_HISTORY_LIST: 'db:history-list',
  DB_HISTORY_ACTIVITY: 'db:history-activity',
  DB_HISTORY_USAGE: 'db:history-usage',
  DB_HISTORY_SAVE_AUDIO: 'db:history-save-audio',
  DB_HISTORY_TRIGGER_DISK_CLEANUP: 'db:history-trigger-disk-cleanup',
  DB_HISTORY_TRIGGER_HISTORY_CLEANUP: 'db:history-trigger-history-cleanup',
  DB_HISTORY_UPSERT: 'db:history-upsert',
  DB_HISTORY_UPSERT_CLIENT_METADATA: 'db:history-upsert-client-metadata',
  DB_HISTORY_UPSERT_MODE_META: 'db:history-upsert-mode-meta',
  DB_HISTORY_V2_MIGRATION_START: 'db:history-v2-migration-start',

  // device
  DEVICE_GET_INFO: 'device:get-info',
  DEVICE_IS_LID_OPEN: 'device:is-lid-open',

  // dictionary
  DICTIONARY_WORD_AUTO_ADDED: 'dictionary:word-auto-added',
  DICTIONARY_LIST: 'dictionary:list',
  DICTIONARY_ADD: 'dictionary:add',
  DICTIONARY_REMOVE: 'dictionary:remove',

  // files
  FILE_CLEAR_LOG: 'file:clear-log',
  FILE_OPEN_LOG: 'file:open-log',
  FILE_OPEN_RECORDINGS: 'file:open-recordings',
  FILE_PICK_AND_PARSE_DICTIONARY_CSV: 'file:pick-and-parse-dictionary-csv',
  FILE_READ_RECORDINGS_SIZE: 'file:read-recordings-size',
  FILE_SAVE_AUDIO_WITH_DIALOG: 'file:save-audio-with-dialog',
  FILE_SAVE_PNG_WITH_DIALOG: 'file:save-png-with-dialog',
  FILE_SAVE_RECORDING_LOG: 'file:save-recording-log',

  // i18n
  I18N_GET_LANGUAGE: 'i18n:get-language',
  I18N_SET_LANGUAGE: 'i18n:set-language',
  I18N_RESET_TO_SYSTEM_LANGUAGE: 'i18n:reset-to-system-language',
  I18N_LANGUAGE_CHANGED: 'i18n:language-changed',

  // keyboard
  KEYBOARD_SET_WATCHER_INTERVAL: 'keyboard:set-watcher-interval',
  KEYBOARD_START_KEYBOARD_LISTENER: 'keyboard:start-keyboard-listener',
  KEYBOARD_STOP_KEYBOARD_LISTENER: 'keyboard:stop-keyboard-listener',
  KEYBOARD_TYPE_TRANSCRIPT: 'keyboard:type-transcript',

  // analytics
  MIXPANEL_TRACK_EVENT: 'mixpanel:track-event',

  // onboarding

  // windows / pages
  PAGE_CHANGE_HUB_ROUTE: 'page:change-hub-route',
  PAGE_CLOSE_ALL_DEVTOOLS: 'page:close-all-devtools',
  PAGE_CLOSE_INTERACTIVE_CARD: 'page:close-interactive-card',
  PAGE_CLOSE_SIDEBAR: 'page:close-sidebar',
  PAGE_COMPLETE_ONBOARDING: 'page:complete-onboarding',
  PAGE_FLOATING_BAR_CLICK: 'page:floating-bar-click',
  PAGE_FLOATING_BAR_SET_ALWAYS_ON_TOP_FOR_WINDOWS: 'page:floating-bar-set-always-on-top-for-windows',
  PAGE_FLOATING_BAR_SET_EXPANDED: 'page:floating-bar-set-expanded',
  PAGE_FLOATING_BAR_UPDATE_POSITIONS: 'page:floating-bar-update-positions',
  PAGE_GET_INTERACTIVE_CARD_PAYLOAD: 'page:get-interactive-card-payload',
  PAGE_IS_ONBOARDING_WINDOW_VISIBLE: 'page:is-onboarding-window-visible',
  PAGE_LAUNCH_APPLICATION: 'page:launch-application',
  PAGE_OPEN_DEVTOOLS: 'page:open-devtools',
  PAGE_OPEN_ENTRY_WINDOW: 'page:open-entry-window',
  PAGE_OPEN_HUB: 'page:open-hub',
  PAGE_OPEN_INTERACTIVE_CARD: 'page:open-interactive-card',
  PAGE_OPEN_SETTINGS_MODAL: 'page:open-settings-modal',
  PAGE_OPEN_SIDEBAR: 'page:open-sidebar',
  PAGE_OPEN_TYPELESS_BAR: 'page:open-typeless-bar',
  PAGE_OPEN_URL: 'page:open-url',
  PAGE_OPEN_URL_SCHEME: 'page:open-url-scheme',
  PAGE_RESTART_TYPELESS_BAR: 'page:restart-typeless-bar',
  PAGE_SET_DEBUG_WINDOW_POSITION: 'page:set-debug-window-position',
  PAGE_SET_HUB_WINDOW_BUTTON_VISIBILITY: 'page:set-hub-window-button-visibility',
  PAGE_UPDATE_INTERACTIVE_CARD_BOUNDS: 'page:update-interactive-card-bounds',
  PAGE_WINDOW_CLOSED: 'page:window-closed',
  PAGE_WINDOW_CREATED: 'page:window-created',

  // permissions
  PERMISSION_CHECK_WITH_CHILD_PROCESS: 'permission:check-with-child-process',
  PERMISSION_DIAGNOSE_MICROPHONE: 'permission:diagnose-microphone',
  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_OPEN_SYSTEM_PREFERENCES: 'permission:open-system-preferences',
  PERMISSION_RESET_ACCESSIBILITY: 'permission:reset-accessibility-permission',
  PERMISSION_UPDATE_AUTO_LAUNCH: 'permission:update-auto-launch',
  PERMISSION_UPDATE_SHOW_APP_IN_DOCK: 'permission:update-show-app-in-dock',

  // recording machine
  RECORDING_MACHINE_SET_DISABLED: 'recording-machine:set-disabled',
  RECORDING_MACHINE_GET_DISABLED: 'recording-machine:get-disabled',
  RECORDING_MACHINE_DISABLED_CHANGED: 'recording-machine:disabled-changed',

  // rsa
  RSA_CLEAR: 'rsa:clear',
  RSA_ENCRYPT: 'rsa:encrypt',
  RSA_GET_CONFIG: 'rsa:get-config',
  RSA_IS_ENABLED: 'rsa:is-enabled',
  RSA_SET_CONFIG: 'rsa:set-config',

  // store
  STORE_USE: 'store:use',


  // troubleshooting
  TROUBLESHOOTING_GET_SYSTEM_INFO: 'troubleshooting:get-system-info',

  // updater
  UPDATER_CHECK_FOR_UPDATE: 'updater:check-for-update',
  UPDATER_CHECK_UPDATE_AND_DOWNLOAD_SILENTLY: 'updater:check-update-and-download-silently',
  UPDATER_CHECKING_FOR_UPDATE: 'updater:checking-for-update',
  UPDATER_DOWNLOAD_PROGRESS: 'updater:download-progress',
  UPDATER_DOWNLOAD_UPDATE: 'updater:download-update',
  UPDATER_QUIT_AND_INSTALL: 'updater:quit-and-install',
  UPDATER_SHOW_DOWNLOADED_NOTIFY: 'updater:show-downloaded-notify',
  UPDATER_UPDATE_AVAILABLE: 'updater:update-available',
  UPDATER_UPDATE_DOWNLOADED: 'updater:update-downloaded',
  UPDATER_UPDATE_ERROR: 'updater:update-error',
  UPDATER_UPDATE_NOT_AVAILABLE: 'updater:update-not-available'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
