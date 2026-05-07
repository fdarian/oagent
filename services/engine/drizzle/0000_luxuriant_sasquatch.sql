CREATE TABLE `available_commands_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`available_commands` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chunk_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`message_id` text,
	`content` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `config_option_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`config_options` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `current_mode_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`current_mode_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`type` text NOT NULL,
	`meta` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_job_created_at_id_idx` ON `events` (`job_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`cwd` text NOT NULL,
	`model` text,
	`created_at` integer NOT NULL,
	`terminated_at` integer,
	`session_id` text,
	`text` text,
	`stop_reason` text,
	`error_message` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_uuid_unique` ON `jobs` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_uuid_uq` ON `jobs` (`uuid`);--> statement-breakpoint
CREATE INDEX `jobs_status_created_at_idx` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `plan_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`entries` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_info_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`title` text,
	`updated_at` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tool_call_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`tool_call_id` text NOT NULL,
	`title` text,
	`status` text,
	`kind` text,
	`content` text,
	`locations` text,
	`raw_input` text,
	`raw_output` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`used` integer NOT NULL,
	`cost_amount` real,
	`cost_currency` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
