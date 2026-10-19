CREATE TABLE IF NOT EXISTS `dictionary` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`word` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`language` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dictionary_user` ON `dictionary` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dictionary_word` ON `dictionary` (`word`);
