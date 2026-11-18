-- The site's own page views, the only traffic source since Umami was removed.
-- One row per page a visitor opens, written by POST /api/track. No IP is
-- stored: signed-in visitors are told apart by `user:<id>`, everyone else by
-- an anonymous uuid in their own cookie, and the place comes from Cloudflare's
-- request metadata.
CREATE TABLE `page_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`post_slug` text,
	`visitor_id` text NOT NULL,
	`country` text,
	`region` text,
	`city` text,
	`referrer_host` text,
	`device` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_views_created_idx` ON `page_views` (`created_at`);--> statement-breakpoint
CREATE INDEX `page_views_path_created_idx` ON `page_views` (`path`,`created_at`);--> statement-breakpoint
CREATE INDEX `page_views_post_slug_created_idx` ON `page_views` (`post_slug`,`created_at`);--> statement-breakpoint
CREATE INDEX `page_views_visitor_created_idx` ON `page_views` (`visitor_id`,`created_at`);
