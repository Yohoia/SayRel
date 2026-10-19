import { sql } from 'drizzle-orm'
import { blob, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * `history_v2` is the live history table. The pre-v2 `history` table is kept
 * only as a migration source and is never written by the app.
 */
export const historyV2 = sqliteTable(
  'history_v2',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('user_id'),
    status: text('status'),
    mode: text('mode').default('voice_transcript'),
    refinedText: text('refined_text'),
    duration: real('duration'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    audioLocalPath: text('audio_local_path'),
    audioMetadata: text('audio_metadata'),
    appVersion: text('app_version').default('0.0.0').notNull(),
    micDevice: text('mic_device'),
    micDeviceInfo: blob('mic_device_info', { mode: 'buffer' }),
    clientMetadata: blob('client_metadata', { mode: 'buffer' }),
    modeMeta: blob('mode_meta', { mode: 'buffer' }),
    debugInfo: text('debug_info'),
    audioContext: text('audio_context'),
    serverUpdatedAt: integer('server_updated_at'),
    syncStatus: text('sync_status').default('pending_upload').notNull(),
    syncAttemptCount: integer('sync_attempt_count').default(0).notNull(),
    syncedFromCloud: integer('synced_from_cloud').default(0).notNull()
  },
  (t) => [
    index('idx_history_v2_user_created_at').on(t.userId, t.createdAt),
    index('idx_history_v2_status').on(t.status),
    index('idx_history_v2_user_status_created_at').on(t.userId, t.status, t.createdAt),
    index('idx_history_v2_push_candidate_v2')
      .on(t.userId, t.syncStatus, t.createdAt, t.syncAttemptCount)
      .where(
        sql`${t.status} = 'completed' AND ((${t.refinedText} IS NOT NULL AND ${t.refinedText} <> '') OR (${t.mode} = 'voice_command' AND json_extract(${t.modeMeta}, '$.aiResult.delivery') = 'external'))`
      )
  ]
)

/** Legacy history shape, retained so v1 data can be migrated on first launch. */
export const history = sqliteTable('history', {
  id: text('id').primaryKey().notNull(),
  refinedText: text('refined_text'),
  audio: blob('audio', { mode: 'buffer' }),
  audioContext: text('audio_context'),
  status: text('status'),
  duration: real('duration'),
  appVersion: text('app_version').default('0.0.0').notNull(),
  editedText: text('edited_text'),
  editedTextStatus: text('edited_text_status').default('NOT_EXTRACTED').notNull(),
  editedTextAttempts: integer('edited_text_attempts').default(0).notNull(),
  languages: text('languages'),
  micDevice: text('mic_device'),
  detectedLanguage: text('detected_language'),
  hasRevertedAI: integer('has_reverted_ai'),
  axText: text('ax_text'),
  axHtml: text('ax_html'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  debugInfo: text('debug_info'),
  audioLocalPath: text('audio_local_path'),
  userId: text('user_id'),
  focusedApp: text('focused_app'),
  audioMetadata: text('audio_metadata'),
  focusedAppName: text('focused_app_name'),
  focusedAppBundleId: text('focused_app_bundle_id'),
  focusedAppWindowTitle: text('focused_app_window_title'),
  focusedAppWindowWebTitle: text('focused_app_window_web_title'),
  focusedAppWindowWebDomain: text('focused_app_window_web_domain'),
  focusedAppWindowWebUrl: text('focused_app_window_web_url'),
  micDeviceInfo: blob('mic_device_info', { mode: 'buffer' }),
  mode: text('mode').default('voice_transcript'),
  modeMeta: text('mode_meta'),
  clientMetadata: blob('client_metadata', { mode: 'buffer' })
})

/** User-maintained dictionary used to bias transcription and refinement. */
export const dictionary = sqliteTable(
  'dictionary',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('user_id'),
    word: text('word').notNull(),
    source: text('source').default('manual').notNull(),
    language: text('language'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    index('idx_dictionary_user').on(t.userId),
    index('idx_dictionary_word').on(t.word)
  ]
)

/** Append-only log of recording sessions, used by the recorder diagnostics. */
export const recordingEvent = sqliteTable(
  'recording_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    type: text('type').notNull(),
    payload: text('payload'),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('idx_recording_event_session').on(t.sessionId, t.createdAt)]
)
