CREATE TABLE IF NOT EXISTS `recording_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_recording_event_session` ON `recording_event` (`session_id`,`created_at`);
