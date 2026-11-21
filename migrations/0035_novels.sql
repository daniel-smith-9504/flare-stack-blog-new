-- The novel shelf: books the Admin imports (EPUB / TXT) or pulls from a free
-- online source. A book's metadata lives here; its chapter text lives in R2
-- (novels/{id}/chapters/{order}.txt), because D1 rows cap at 2 MB.
CREATE TABLE `novels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL DEFAULT '',
	`description` text NOT NULL DEFAULT '',
	`category` text,
	`cover_url` text,
	`source` text NOT NULL DEFAULT 'upload',
	`source_id` text,
	`language` text,
	`status` text NOT NULL DEFAULT 'pending',
	`error` text,
	`file_key` text,
	`file_format` text,
	`chapter_count` integer NOT NULL DEFAULT 0,
	`word_count` integer NOT NULL DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `novels_updated_idx` ON `novels` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `novels_category_idx` ON `novels` (`category`,`updated_at`);--> statement-breakpoint
CREATE INDEX `novels_status_idx` ON `novels` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `novel_chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`novel_id` integer NOT NULL,
	`chapter_order` integer NOT NULL,
	`title` text NOT NULL DEFAULT '',
	`word_count` integer NOT NULL DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novel_chapters_order_idx` ON `novel_chapters` (`novel_id`,`chapter_order`);
--> statement-breakpoint
CREATE TABLE `novel_progress` (
	`user_id` text NOT NULL,
	`novel_id` integer NOT NULL,
	`chapter_order` integer NOT NULL DEFAULT 1,
	`progress_ratio` real NOT NULL DEFAULT 0,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `novel_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_progress_updated_idx` ON `novel_progress` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `novel_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`novel_id` integer NOT NULL,
	`chapter_order` integer NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`quote` text NOT NULL,
	`context_before` text NOT NULL DEFAULT '',
	`context_after` text NOT NULL DEFAULT '',
	`note` text NOT NULL DEFAULT '',
	`is_public` integer NOT NULL DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`novel_id`) REFERENCES `novels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_notes_chapter_idx` ON `novel_notes` (`novel_id`,`chapter_order`,`start_offset`);--> statement-breakpoint
CREATE INDEX `novel_notes_user_idx` ON `novel_notes` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `novel_notes_public_idx` ON `novel_notes` (`novel_id`,`is_public`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `novel_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL DEFAULT 'light',
	`font_size` integer NOT NULL DEFAULT 18,
	`line_height` real NOT NULL DEFAULT 1.8,
	`font_family` text NOT NULL DEFAULT 'serif',
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
