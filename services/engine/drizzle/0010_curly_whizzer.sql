CREATE TABLE `side_chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`source_job_id` integer NOT NULL,
	`session_id` text,
	`first_turn_dispatched_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `side_chats_uuid_uq` ON `side_chats` (`uuid`);--> statement-breakpoint
CREATE INDEX `side_chats_source_job_created_at_idx` ON `side_chats` (`source_job_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `side_chat_id` integer REFERENCES side_chats(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `jobs_side_chat_created_at_idx` ON `jobs` (`side_chat_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_side_chat_running_uq` ON `jobs` (`side_chat_id`) WHERE "jobs"."status" = 'running';
