-- Reading features from the reference novel site: paged mode and five themes
-- in the reader's settings, bookmarks, daily reading time, shelf tags, and the
-- social layer on shared highlights (likes, reports, votes, points and mutes).
ALTER TABLE `novel_chapters` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `novel_notes` ADD `status` text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE `novel_notes` ADD `report_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `novel_notes` ADD `removed_by` text;--> statement-breakpoint
ALTER TABLE `novel_notes` ADD `removed_at` integer;--> statement-breakpoint
ALTER TABLE `novel_notes` ADD `remove_reason` text;--> statement-breakpoint
ALTER TABLE `novel_settings` ADD `page_width` integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE `novel_settings` ADD `reading_mode` text DEFAULT 'scroll' NOT NULL;--> statement-breakpoint
ALTER TABLE `page_views` ADD `novel_id` integer;--> statement-breakpoint
ALTER TABLE `page_views` ADD `novel_chapter` integer;--> statement-breakpoint
CREATE INDEX `page_views_novel_idx` ON `page_views` (`novel_id`,`novel_chapter`,`created_at`);--> statement-breakpoint
CREATE TABLE `novel_bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`novel_id` integer NOT NULL,
	`chapter_order` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novel_bookmarks_unique_idx` ON `novel_bookmarks` (`user_id`,`novel_id`,`chapter_order`);--> statement-breakpoint
CREATE INDEX `novel_bookmarks_user_idx` ON `novel_bookmarks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `novel_reading_daily` (
	`user_id` text NOT NULL,
	`novel_id` integer NOT NULL,
	`day` text NOT NULL,
	`seconds` integer DEFAULT 0 NOT NULL,
	`words` integer DEFAULT 0 NOT NULL,
	`chapters` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `novel_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_reading_daily_novel_idx` ON `novel_reading_daily` (`novel_id`,`day`);--> statement-breakpoint
CREATE TABLE `novel_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novel_tags_slug_idx` ON `novel_tags` (`slug`);--> statement-breakpoint
CREATE TABLE `novel_tag_links` (
	`novel_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`novel_id`, `tag_id`),
	FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `novel_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_tag_links_tag_idx` ON `novel_tag_links` (`tag_id`);--> statement-breakpoint
CREATE TABLE `novel_note_likes` (
	`note_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`note_id`, `user_id`),
	FOREIGN KEY (`note_id`) REFERENCES `novel_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_note_likes_user_idx` ON `novel_note_likes` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `novel_note_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` integer NOT NULL,
	`reporter_id` text,
	`reporter_key` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `novel_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `novel_note_reports_note_idx` ON `novel_note_reports` (`note_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `novel_note_reports_unique_idx` ON `novel_note_reports` (`note_id`,`reporter_key`);--> statement-breakpoint
CREATE TABLE `novel_note_votes` (
	`note_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`choice` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`note_id`, `user_id`),
	FOREIGN KEY (`note_id`) REFERENCES `novel_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_note_votes_choice_idx` ON `novel_note_votes` (`note_id`,`choice`);--> statement-breakpoint
CREATE TABLE `novel_score_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`delta` real NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_score_logs_user_idx` ON `novel_score_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `novel_mutes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`level` integer NOT NULL,
	`until` integer,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_mutes_user_idx` ON `novel_mutes` (`user_id`,`created_at`);
